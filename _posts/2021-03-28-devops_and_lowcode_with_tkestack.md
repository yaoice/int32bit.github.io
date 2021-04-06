---
layout: post
title: 基于TKEStack的DevOps流程
subtitle: ""
catalog: true
hide: true
tags:
- k8s
---

- TKEStack版本：v1.6.0

## DevOps on TKEStack

### 1. TKEStack部署

#### 1.1 部署架构

产品架构图：（从[https://tkestack.github.io/docs/installation/installation-architecture.html](https://tkestack.github.io/docs/installation/installation-architecture.html)引用）
<img src="https://tkestack.github.io/docs/images/tkestackhighlevelarchitecture-2x.png"/>

架构说明：
>TKEStack 采用了 Kubernetes on Kubernetes 的设计理念。
>即节点仅运行 Kubelet 进程，其他组件均采用容器化部署，由 Kubernetes 进行管理。 

>架构上分为Global集群和业务集群。
>Global集群运行整个容器服务开源版平台自身所需要的组件，业务集群运行用户业务。
>在实际的部署过程中，可根据实际情况进行调整。

#### 1.2 部署模块

模块说明：
- Installer: 运行 tke-installer 安装器的节点，用于提供 Web UI 指导用户在 Global 集群部署TKEStacl控制台；
- Global Cluster: 运行的 TKEStack 控制台的 Kubernetes 集群；
- Cluster: 运行业务的 Kubernetes 集群，可以通过 TKEStack 控制台创建或导入；
- Auth: 权限认证组件，提供用户鉴权、权限对接相关功能；
- Gateway: 网关组件，实现集群后台统一入口、统一鉴权相关的功能，并运行控制台的 Web 界面服务；
- Platform: 集群管理组件，提供 Global 集群管理多个业务集群相关功能；
- Business: 业务管理组件，提供平台业务管理相关功能的后台服务；
- Network Controller：网络服务组件，支撑 Galaxy 网络功能；
- Monitor: 监控服务组件，提供监控采集、上报、告警相关服务；
- Notify: 通知功能组件，提供消息通知相关的功能；
- Registry: 镜像服务组件，提供平台镜像仓库服务；

#### 1.3 配置安装

初始化install节点
```
arch=amd64 version=v1.6.0 && wget https://tke-release-1251707795.cos.ap-guangzhou.myqcloud.com/tke-installer-linux-$arch-$version.run{,.sha256} && sha256sum --check --status tke-installer-linux-$arch-$version.run.sha256 && chmod +x tke-installer-linux-$arch-$version.run && ./tke-installer-linux-$arch-$version.run
```
```
Step.1 prefight
root: yes
available disk space(/opt):  44 GiB
available disk space(/var/lib):  44 GiB
Step.2 ensure docker is ok
command docker not find
install docker [doing]
docker/containerd
docker/docker-init
docker/ctr
docker/containerd-shim
docker/runc
docker/docker-proxy
docker/dockerd
docker/docker
‘res/docker.service’ -> ‘/etc/systemd/system/docker.service’
‘res/daemon.json’ -> ‘/etc/docker/daemon.json’
install docker [ok]
Step.3 load tke-installer image [doing]
3cb2494d9fa7: Loading layer  5.838MB/5.838MB
542c8c6e2ee3: Loading layer   2.56kB/2.56kB
24e96d67d700: Loading layer  2.048kB/2.048kB
f7d3524c5ddb: Loading layer  445.8MB/445.8MB
e112aad11236: Loading layer  3.184MB/3.184MB
262af19c61e1: Loading layer  7.906GB/7.906GB
281437fcca51: Loading layer  2.048kB/2.048kB
Loaded image: tkestack/tke-installer-amd64:v1.6.0
Step.3 load tke-installer image [ok]
Step.4 clean old data [doing]
find: ‘/opt/tke-installer/data/*’: No such file or directory
Step.4 clean old data [ok]
Step.5 start tke-installer [doing]
bb5a9e6334a5980bc575be37961f2ef3c921779a1a341daf7936feb77da9d2e6
Step.5 start tke-installer [ok]
Step.6 check tke-installer status [doing]
Step.6 check tke-installer status [ok]
Please use your browser which can connect this machine to open http://127.0.0.1:8080/index.html 
for install TKE!
```
打开http://<SERVER-IP>:8080，根据部署界面提示安装

### 2. 编译环境准备

#### 2.1 maven

Maven就是是专门为Java项目打造的管理和构建工具

### 2.2 Dockerfile

```
# Building stage
FROM maven:3.5.4-jdk-8-alpine as builder

WORKDIR /usr/src/dev

# Source code, building tools and dependences
COPY settings.xml /usr/share/maven/ref/
COPY . /usr/src/dev

ENV TIMEZONE "Asia/Shanghai"

RUN mvn -B -f pom.xml -s /usr/share/maven/ref/settings.xml clean install
RUN ls /usr/src/dev-resource/target/

# Production stage
FROM openjdk:8-jre-slim
WORKDIR /java/bin

# copy the go binaries from the building stage
COPY --from=builder /usr/src/dev/target/xxx.jar /java/bin

# copy the config files from the current working dir

EXPOSE 80
ENTRYPOINT ["java", "-jar", "xxx.jar"]
```
Dockerfile两步编译阶段，第一个编译阶段利用maven镜像编译出来的产物复制给第二个编译阶段

#### 2.3 local-pvc-provisioner

```shell
# wget -c https://raw.githubusercontent.com/kubernetes-sigs/sig-storage-local-static-provisioner/master/deployment/kubernetes/example/default_example_provisioner_generated.yaml
```
这里`fsType: xfs`,  dockerhub上有local-volume-provisioner镜像`docker pull googleimages/local-volume-provisioner:v2.4.0`，可能无法访问gcr.io镜像仓库地址

部署local-volume-provisioner

```shell
# kubectl apply -f default_example_provisioner_generated.yaml

# kubectl  get ds
NAME                       DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
local-volume-provisioner   1         1         1       1            1           <none>          12m

# kubectl  get pod
NAME                              READY   STATUS    RESTARTS   AGE
local-volume-provisioner-nrww4    1/1     Running   0          12m
```

创建local-volume-storageclass

```yaml
# kubectl apply -f - << EOF
kind: StorageClass
apiVersion: storage.k8s.io/v1
metadata:
  name: fast-disks
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
EOF

#设置为默认storageclass
# kubectl patch storageclass fast-disks -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```

local-volume-provisioner默认的可发现目录（discovery directory）是`/mnt/fast-disks`，挂载到这里的目录必须是mount进来，手动创建目录是不会被自动转换为PV的

```shell
mkdir -p /opt/k8s/localpv/{sda,sdb,sdc}
mkdir -p /mnt/fast-disks/{sda,sdb,sdc}
mount --bind /opt/k8s/localpv/sda /mnt/fast-disks/sda
mount --bind /opt/k8s/localpv/sda /mnt/fast-disks/sdb
mount --bind /opt/k8s/localpv/sda /mnt/fast-disks/sdc
```

创建pod，验证local-pv

```yaml
# kubectl apply -f - << EOF
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  name: pvc-local
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  storageClassName: fast-disks
---
apiVersion: v1
kind: Pod
metadata:
  name: pv-local-pod
spec:
  volumes:
  - name: example-pv-local
    persistentVolumeClaim:
      claimName: pvc-local
  containers:
  - name: example-pv-local
    image: nginx
    ports:
    - containerPort: 80
    volumeMounts:
    - mountPath: /usr/share/nginx/html
      name: example-pv-local
EOF      
```

```bash
# kubectl get pod nginx-c48bdb85c-clbtt
NAME                    READY   STATUS    RESTARTS   AGE
nginx-c48bdb85c-clbtt   1/1     Running   0          4d23h

# kubectl get pvc pvc-local
NAME        STATUS   VOLUME              CAPACITY   ACCESS MODES   STORAGECLASS   AGE
pvc-local   Bound    local-pv-ffd50f12   208Gi      RWO            fast-disks     46s
```


### 3. DevOps流程

DevOps工作流集成了镜像仓库、应用仓库、jenkins、gitlab；TKEStack自带镜像仓库和Chart仓库，而不是对接Harbor.Harbor太重了, harbor除了镜像仓库、chart仓库还有远程仓库复制、镜像扫描等功能。

### 辅助工具安装

#### helm-push插件 

helm-push插件离线安装
```
# wget -c https://github.com/chartmuseum/helm-push/releases/download/v0.9.0/helm-push_0.9.0_linux_amd64.tar.gz
# mkdir -p $HOME/.local/share/helm/plugins/helm-push
# tar xf helm-push_0.9.0_linux_amd64.tar.gz -C $HOME/.local/share/helm/plugins/helm-push/
```






### 4. 参考链接

- [https://tkestack.github.io/docs/installation/installation-architecture.html](https://tkestack.github.io/docs/installation/installation-architecture.html)
- [https://linkscue.com/posts/2019-09-18-kubernetes-local-volume-provisioner/](https://linkscue.com/posts/2019-09-18-kubernetes-local-volume-provisioner/)


