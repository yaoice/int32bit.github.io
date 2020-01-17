---
layout: post
title: Pod preset自动化配置k8s容器时区
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

- Kubernetes v1.14.6
- Etcd 3.3.12
- Docker 18.09.9
- Kernel 4.4.131

### 现象

pod默认时区与宿主机时区不一致

宿主机时区
```
# date 
Fri Jan 17 19:42:13 CST 2020
```

容器时区
```
# vim nginx.yaml 
---
apiVersion: extensions/v1beta1
kind: Deployment
metadata:
  labels:
    run: test-hello
  name: test-hello
  namespace: default
spec:
  progressDeadlineSeconds: 600
  replicas: 1
  revisionHistoryLimit: 10
  selector:
    matchLabels:
      run: test-hello
  strategy:
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 25%
    type: RollingUpdate
  template:
    metadata:
      labels:
        run: test-hello
    spec:
      containers:
      - image: nginx:alpine
        imagePullPolicy: IfNotPresent
        resources:
          limits:
            cpu: 50m
            memory: 100Mi
          requests:
            cpu: 10m
            memory: 16Mi
        name: test-hello
        ports:
        - containerPort: 80
          protocol: TCP
      dnsPolicy: ClusterFirst
      restartPolicy: Always

# kubectl apply -f nginx.yaml
```

```
# kubectl exec -it test-hello-74b6f65659-5wk2m -- date
Fri Jan 17 11:46:00 UTC 2020
```
默认pod容器时区是UTC, 而宿主机时区是CST. 很多时候都要求时区跟当地时区一致，有利于查找日志.

### 解决方法

#### 方法一

用传统老办法，就是把宿主机/etc/localtime映射到容器的/etc/localtime

修改nginx.yaml，增加volumeMount
```
        name: test-hello
        ports:
        - containerPort: 80
          protocol: TCP
        volumeMounts:
        - name: timezone-config
          mountPath: /etc/localtime
          readOnly: true
      volumes:
      - name: timezone-config
        hostPath:
          path: /etc/localtime
```

```
# kubectl apply -f nginx.yaml
```

```
# kubectl exec -it test-hello-5488f954c6-qs4kx -- date
Fri Jan 17 20:09:35 CST 2020
```
容器时区设置为CST了

#### 方法二

设置环境变量, 修改nginx.yaml
```
    spec:
      containers:
      - image: nginx:alpine
        imagePullPolicy: IfNotPresent
        resources:
          limits:
            cpu: 50m
            memory: 100Mi
          requests:
            cpu: 10m
            memory: 16Mi
        name: test-hello
        env:
        - name: TZ
          value: Asia/Shanghai
```

```
# kubectl apply -f nginx.yaml
```

```
# kubectl exec -it test-hello-8666c776d7-n4h4x -- date
Fri Jan 17 20:04:12 CST 2020
```
容器时区设置为CST了

#### 方法三

上面两种方法虽然都可以解决容器时区问题，有没一劳永逸的方法，
调研得到k8s有Pod Preset功能来达到对pod进行一些预处理的配置

验证是否启用了podpresets功能
```
# kubectl get podpresets
error: the server doesn't have a resource type "podpresets"
```
调用失败，说明需要启用podpresets功能

修改所有master节点的kube-apiserver.yaml, 启用podpresets功能
```
# vim /etc/kubernetes/manifests/kube-apiserver.yaml
spec:
  containers:
  - command:
    - kube-apiserver
    ...增加如下两行配置
    - --runtime-config=settings.k8s.io/v1alpha1=true
    - --enable-admission-plugins=NodeRestriction,PodPreset
```

```
# kubectl get podpresets
No resources found.
```
调用正常

创建setting-tz.yaml
```
# vim setting-tz.yaml
apiVersion: settings.k8s.io/v1alpha1
kind: PodPreset
metadata:
  name: setting-tz
spec:
  selector:
    matchLabels:
  env:
    - name: TZ
      value: Asia/Shanghai
```
基于selector...matchLabels来匹配的，matchLabels为空表明应用于该命名空间下所有容器

```
# kubectl apply -f setting-tz.yaml 
podpreset.settings.k8s.io/setting-tz created
```

```
# kubectl get podpresets.settings.k8s.io 
NAME         CREATED AT
setting-tz   2020-01-17T12:32:22Z
```
将上述的nginx.yaml中有关时区的部分都删掉, 然后重新apply

有几个需要注意的点：
1. 针对新创建的pod，没问题，会自动配置时区
2. 针对已创建的pod，需要把pod重启，才会自动配置时区
3. podpresets是namespace对象

#### 方法四

基于方法三的基础上，可以实现个自动创建podpresets于各个命名空间的自定义controller

### 参考链接

- [Pod Preset玩转K8S容器时区自动配置](https://blog.csdn.net/xstardust/article/details/82705205)