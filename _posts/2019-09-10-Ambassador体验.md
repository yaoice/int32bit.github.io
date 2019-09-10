---
layout: post
title: Ambassador体验
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

- OS: CentOS 7.5
- Kubernetes v1.14.1
- Etcd 3.3.10
- Docker 1.13.1

### 什么是Ambassador

Ambassador是一个专门的控制平面，将Kubernetes annotations转换为Envoy配置。所有流量都由高性能Envoy代理直接处理。


### Ambassador部署

采用helm chart部署方式

克隆官方helm charts仓库
```
git clone https://github.com/helm/charts.git
```

编辑stable/ambassador/values.yaml，使用NodePort暴露端口
```
vim charts/stable/ambassador/values.yaml
service:
  type: NodePort
  ports:
    - name: http
      port: 80
      targetPort: 8080
      protocol: TCP
      nodePort: 30080
    - name: https
      port: 443
      targetPort: 8443
      protocol: TCP
      nodePort: 30443

adminService:
  create: true
  type: NodePort
  port: 8877
  # NodePort used if type is NodePort
  nodePort: 38877

crds:
  enabled: true
  create: true
  keep: false
```

安装
```
helm upgrade --install my-release charts/stable/ambassador/
```

查看ambassador pod/service
```
[/data/ambassador/qotm]# kubectl get pod
NAME                                     READY   STATUS    RESTARTS   AGE
my-release-ambassador-6f6b5b99cc-vpcv6   1/1     Running   1          131m
my-release-ambassador-6f6b5b99cc-wx9ql   1/1     Running   1          131m
my-release-ambassador-6f6b5b99cc-xm22b   1/1     Running   1          131m
```

```
[/data/ambassador/qotm]# kubectl get svc
NAME                          TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)                      AGE
my-release-ambassador         NodePort    10.68.30.6      <none>        80:30080/TCP,443:30443/TCP   132m
my-release-ambassador-admin   NodePort    10.68.89.150    <none>        8877:38877/TCP               132m
```

### 测试验证

```
vim qotm.yaml
---
apiVersion: v1
kind: Service
metadata:
  name: qotm
  annotations:
    getambassador.io/config: |
      ---
      apiVersion: ambassador/v0
      kind:  Mapping
      name:  qotm_mapping
      prefix: /qotm/
      service: qotm
spec:
  selector:
    app: qotm
  ports:
  - port: 80
    name: http-qotm
    targetPort: http-api
---
apiVersion: extensions/v1beta1
kind: Deployment
metadata:
  name: qotm
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
  template:
    metadata:
      labels:
        app: qotm
    spec:
      containers:
      - name: qotm
        image: datawire/qotm:1.1
        ports:
        - name: http-api
          containerPort: 5000
        resources:
          limits:
            cpu: "0.1"
            memory: 100Mi
```

```
kubectl apply -f qotm.yaml
```

浏览器访问qotm应用
```
http://<宿主机ip>:30080/qotm/
```

### 开启diagnostic界面

浏览器访问ambassador diagnostic界面
```
http://<宿主机ip>:38877/ambassador/v0/diag/
```

获取json返回结果
```
curl http://<宿主机ip>:38877/ambassador/v0/diag/?json=true\
```

### 代理grpc

### 开启grpc-web



### 参考链接

- [ambassador 学习教程](https://www.cnblogs.com/rongfengliang/category/1248215.html)
- [https://www.getambassador.io/features](https://www.getambassador.io/features)
