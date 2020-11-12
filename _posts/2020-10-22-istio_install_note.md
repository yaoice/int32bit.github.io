---
layout: post
title: istio安装笔记
subtitle: ""
catalog: true
tags:
     - istio
---

### 环境

- 系统：Ubuntu 20.04.1 LTS
- kernel: 5.4.0-52-generic
- Kubernetes: v1.19.3
- Istio版本：1.7.4
 
### 安装K8s

#### 禁用swap

临时关闭swap
```
# swapoff -a
```

编辑/etc/fstab,禁用swap分区的挂载; swappiness参数调整
```
# vim /etc/sysctl.d/k8s.conf   # 添加如下内容
vm.swappiness=0

# sysctl -p /etc/sysctl.d/k8s.conf  # 使之生效
```

#### 设置sysctl

内核是否加载br_netfilter模块
```
# lsmod | grep br_netfilter
```

设置iptables可以过滤bridge traffic
```
cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-ip6tables = 1
net.bridge.bridge-nf-call-iptables = 1
EOF
sudo sysctl --system 
```

calico网络插件，而calico需要这个内核参数是0或者1，但是Ubuntu20.04上默认是2，
```
cat <<EOF | sudo tee /etc/sysctl.d/10-network-security.conf
net.ipv4.conf.default.rp_filter=1
net.ipv4.conf.all.rp_filter=1
EOF
sudo sysctl --system 
```

#### 安装Docker

```
# apt update && apt install docker.io
# systemctl start docker
# systemctl enable docker
```

#### 安装k8s master

```
# apt-get update && sudo apt-get install -y ca-certificates \
    curl software-properties-common \
    apt-transport-https curl
```

```
# curl -s https://mirrors.aliyun.com/kubernetes/apt/doc/apt-key.gpg | sudo apt-key add -
```

```
# tee /etc/apt/sources.list.d/kubernetes.list <<EOF 
deb https://mirrors.aliyun.com/kubernetes/apt/ kubernetes-xenial main
EOF
```

```
# apt-get update
# apt-get install -y kubelet kubeadm kubectl
# apt-mark hold kubelet kubeadm kubectl
```

```
# kubeadm init --pod-network-cidr 172.16.0.0/16 \
    --image-repository registry.cn-hangzhou.aliyuncs.com/google_containers
```
172.16.0.0/16 cidr, 待会下面calico也会用到

```
# mkdir -p $HOME/.kube
# cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
# chown $(id -u):$(id -g) $HOME/.kube/config

# kubeadm join 1.2.3.4:6443 --token buoag9.acokh9epbt7m7k8s \
    --discovery-token-ca-cert-hash sha256:4096a2262d64673f6eb583cefaeef705349d2c6ace066ec4ac42828b28e9f4bf 
```
kubeadm join的命令, 供加入worker节点用

设置master节点可调度
```
# kubectl taint nodes --all node-role.kubernetes.io/master-
```

### 安装calico

```
# wget -c https://docs.projectcalico.org/v3.11/manifests/calico.yaml
```

修改calico.yaml
```
CALICO_IPV4POOL_CIDR: 172.16.0.0/16
```

```
# kubectl apply -f calico.yaml
```

```
# kubectl get nodes
NAME             STATUS   ROLES    AGE   VERSION
xiabingyao-lc0   Ready    master   14h   v1.19.3
```

```
# kubectl  get pod -A
NAMESPACE     NAME                                       READY   STATUS    RESTARTS   AGE
kube-system   calico-kube-controllers-6b8f6f78dc-l4z4r   1/1     Running   0          14h
kube-system   calico-node-sn8rk                          1/1     Running   0          14h
kube-system   coredns-6c76c8bb89-cwhz2                   1/1     Running   0          14h
kube-system   coredns-6c76c8bb89-hph2t                   1/1     Running   0          14h
kube-system   etcd-xiabingyao-lc0                        1/1     Running   0          14h
kube-system   kube-apiserver-xiabingyao-lc0              1/1     Running   0          14h
kube-system   kube-controller-manager-xiabingyao-lc0     1/1     Running   0          14h
kube-system   kube-proxy-7jbqs                           1/1     Running   0          14h
kube-system   kube-scheduler-xiabingyao-lc0              1/1     Running   0          14h
```

### 安装istio

下载istio
```
# curl -L https://istio.io/downloadIstio | sh -
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100   102  100   102    0     0     28      0  0:00:03  0:00:03 --:--:--    28
100  4277  100  4277    0     0   1042      0  0:00:04  0:00:04 --:--:-- 13160

Downloading istio-1.7.4 from https://github.com/istio/istio/releases/download/1.7.4/istio-1.7.4-linux-amd64.tar.gz ...

Istio 1.7.4 Download Complete!

Istio has been successfully downloaded into the istio-1.7.4 folder on your system.

Next Steps:
See https://istio.io/latest/docs/setup/install/ to add Istio to your Kubernetes cluster.

To configure the istioctl client tool for your workstation,
add the /root/istio-1.7.4/bin directory to your environment path variable with:
     export PATH="$PATH:/root/istio-1.7.4/bin"

Begin the Istio pre-installation check by running:
     istioctl x precheck 

Need more information? Visit https://istio.io/latest/docs/setup/install/
```

istioctl加入PATH，kubectl命令行不全，istioctl命令行补全
```
# vim .bashrc  # 添加如下内容
source <(kubectl completion bash)
export PATH="$PATH:/root/istio-1.7.4/bin"
source ~/istio-1.7.4/tools/istioctl.bash
```

安装 demo 配置
```
# istioctl manifest install --set profile=demo
```

```
# kubectl -n istio-system get pod
NAME                                    READY   STATUS    RESTARTS   AGE
istio-egressgateway-844fd8c8c6-llxjs    1/1     Running   0          3h58m
istio-ingressgateway-67fc4949df-bwvh2   1/1     Running   0          3h58m
istiod-766d57484-rx4tq                  1/1     Running   0          4h

# kubectl -n istio-system get svc
NAME                   TYPE           CLUSTER-IP     EXTERNAL-IP   PORT(S)                                                                      AGE
istio-egressgateway    ClusterIP      10.96.63.196   <none>        80/TCP,443/TCP,15443/TCP                                                     3h58m
istio-ingressgateway   LoadBalancer   10.107.85.29   <pending>     15021:30197/TCP,80:32242/TCP,443:30567/TCP,31400:31724/TCP,15443:30271/TCP   3h58m
istiod                 ClusterIP      10.99.20.87    <none>        15010/TCP,15012/TCP,443/TCP,15014/TCP,853/TCP                                4h
```
集群运行在一个不支持外部负载均衡器的环境中，istio-ingressgateway的EXTERNAL-IP将显示为 <pending> 状态。
可使用服务的NodePort或端口转发来访问网关.

### 注入Sidecar

>为了充分利用 Istio 的所有特性，网格中的 pod 必须运行一个 Istio sidecar 代理。
下面的章节描述了向 pod 中注入 Istio sidecar 的两种方法：使用`istioctl`手动注入或启用 pod 所属命名空间的 Istio sidecar 注入器自动注入。
手动注入直接修改配置，如 deployment，并将代理配置注入其中。
当pod所属命名空间启用自动注入后，自动注入器会使用准入控制器在创建Pod时自动注入代理配置。
通过应用`istio-sidecar-injector`ConfigMap 中定义的模版进行注入。

#### 手动注入

使用`istioctl kube-inject`实现注入，默认使用集群内的配置完成注入
```
# istioctl kube-inject -f samples/sleep/sleep.yaml | kubectl apply -f -
```

也可以使用该配置的本地副本完成注入
```
kubectl -n istio-system get configmap istio-sidecar-injector -o=jsonpath='{.data.config}' > inject-config.yaml
kubectl -n istio-system get configmap istio-sidecar-injector -o=jsonpath='{.data.values}' > inject-values.yaml
kubectl -n istio-system get configmap istio -o=jsonpath='{.data.mesh}' > mesh-config.yaml
istioctl kube-inject \
    --injectConfigFile inject-config.yaml \
    --meshConfigFile mesh-config.yaml \
    --valuesFile inject-values.yaml \
    --filename samples/sleep/sleep.yaml \
    | kubectl apply -f -
```

READY 2/2说明sidecar已经被注入到sleep的pod中
```
~/istio-1.7.4# kubectl get pod 
NAME                     READY   STATUS    RESTARTS   AGE
sleep-77dd9bc8dc-mr7lt   2/2     Running   0          11m
```
#### 自动注入

使用 Istio 提供的准入控制器变更 webhook，可以将 sidecar 自动添加到可用的 Kubernetes pod 中.

这个版本的kube-apiserver默认启用`MutatingAdmissionWebhook`和`ValidatingAdmissionWebhook`

```
# kubectl get mutatingwebhookconfigurations.admissionregistration.k8s.io  -A
NAME                     WEBHOOKS   AGE
istio-sidecar-injector   1          46h
 
# kubectl get validatingwebhookconfigurations.admissionregistration.k8s.io 
NAME                  WEBHOOKS   AGE
istiod-istio-system   1          46h
```
当你在一个命名空间中设置了 istio-injection=enabled 标签，且 injection webhook 被启用后，任何新的 pod 都有将在创建时自动添加 sidecar。

Note: 区别于手动注入，自动注入发生在 pod 层面。你将看不到 deployment 本身有任何更改。取而代之，需要检查单独的 pod（使用 kubectl describe）来查询被注入的代理。

```
# kubectl label namespace default istio-injection=enabled
namespace/default labeled
# kubectl get namespace -L istio-injection
NAME              STATUS   AGE     ISTIO-INJECTION
default           Active   2d13h   enabled
istio-system      Active   46h     disabled
kube-node-lease   Active   2d13h   
kube-public       Active   2d13h   
kube-system       Active   2d13h 
```

```
# kubectl get pod
NAME                     READY   STATUS    RESTARTS   AGE
sleep-854565cb79-qkklc   2/2     Running   0          52s
```

```
# kubectl describe pod -l app=sleep
Events:
  Type    Reason     Age   From               Message
  ----    ------     ----  ----               -------
  Normal  Scheduled  44s   default-scheduler  Successfully assigned default/sleep-854565cb79-qkklc to xiabingyao-lc0
  Normal  Pulling    43s   kubelet            Pulling image "docker.io/istio/proxyv2:1.7.4"
  Normal  Pulled     40s   kubelet            Successfully pulled image "docker.io/istio/proxyv2:1.7.4" in 2.376722895s
  Normal  Created    40s   kubelet            Created container istio-init
  Normal  Started    40s   kubelet            Started container istio-init
  Normal  Pulled     39s   kubelet            Container image "governmentpaas/curl-ssl" already present on machine
  Normal  Created    39s   kubelet            Created container sleep
  Normal  Started    39s   kubelet            Started container sleep
  Normal  Pulling    39s   kubelet            Pulling image "docker.io/istio/proxyv2:1.7.4"
  Normal  Pulled     36s   kubelet            Successfully pulled image "docker.io/istio/proxyv2:1.7.4" in 2.598229594s
  Normal  Created    36s   kubelet            Created container istio-proxy
  Normal  Started    36s   kubelet            Started container istio-proxy
```
istio-proxy容器被注入进去了

可以设置annotation`sidecar.istio.io/inject`来禁用sidecar注入
```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ignored
spec:
  template:
    metadata:
      annotations:
        sidecar.istio.io/inject: "false"
    spec:
      containers:
      - name: ignored
        image: tutum/curl
        command: ["/bin/sleep","infinity"]
```

### 部署Bookinfo应用

#### Bookinfo应用介绍
>这个示例部署了一个用于演示多种 Istio 特性的应用，该应用由四个单独的微服务构成。 这个应用模仿在线书店的一个分类，显示一本书的信息。 页面上会显示一本书的描述，书籍的细节（ISBN、页数等），以及关于这本书的一些评论。

Bookinfo应用分为四个单独的微服务：
 
- productpage: 这个微服务会调用 details 和 reviews 两个微服务，用来生成页面。
- details: 这个微服务中包含了书籍的信息。
- reviews: 这个微服务中包含了书籍相关的评论。它还会调用 ratings 微服务。
- ratings: 这个微服务中包含了由书籍评价组成的评级信息。

reviews微服务有3个版本：
 
- v1 版本不会调用 ratings 服务。
- v2 版本会调用 ratings 服务，并使用 1 到 5 个黑色星形图标来显示评分信息。
- v3 版本会调用 ratings 服务，并使用 1 到 5 个红色星形图标来显示评分信息。

>Bookinfo 应用中的几个微服务是由不同的语言编写的。 
>这些服务对 Istio 并无依赖，但是构成了一个有代表性的服务网格的例子：它由多个服务、多个语言构成，并且reviews服务具有多个版本。

>要在Istio中运行这一应用，无需对应用自身做出任何改变.您只要简单的在Istio环境中对服务进行配置和运行，具体一点说就是把Envoy sidecar注入到每个服务之中. 
>最终的部署结果将如下图所示：

<img src="/img/posts/2020-10-22/withistio.svg"/>

>所有的微服务都和Envoy sidecar集成在一起，被集成服务所有的出入流量都被sidecar所劫持，
>这样就为外部控制准备了所需的Hook，然后就可以利用Istio控制平面为应用提供服务路由、遥测数据收集以及策略实施等功能。

#### 具体部署
```
# kubectl label namespace default istio-injection=enabled

# kubectl apply -f samples/bookinfo/platform/kube/bookinfo.yaml
service/details created
serviceaccount/bookinfo-details created
deployment.apps/details-v1 created
service/ratings created
serviceaccount/bookinfo-ratings created
deployment.apps/ratings-v1 created
service/reviews created
serviceaccount/bookinfo-reviews created
deployment.apps/reviews-v1 created
deployment.apps/reviews-v2 created
deployment.apps/reviews-v3 created
service/productpage created
serviceaccount/bookinfo-productpage created
deployment.apps/productpage-v1 created
```

确认应用已启动
```
# kubectl get pod
NAME                              READY   STATUS    RESTARTS   AGE
details-v1-79c697d759-g2h6w       2/2     Running   0          6m35s
productpage-v1-65576bb7bf-psdp8   2/2     Running   0          6m33s
ratings-v1-7d99676f7f-t9jzd       2/2     Running   0          6m35s
reviews-v1-987d495c-qk6zk         2/2     Running   0          6m34s
reviews-v2-6c5bf657cf-8httm       2/2     Running   0          6m34s
reviews-v3-5f7b9f4f77-f2gq5       2/2     Running   0          6m34s
```

```
# kubectl get service
NAME          TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
details       ClusterIP   10.105.17.2     <none>        9080/TCP   6m58s
kubernetes    ClusterIP   10.96.0.1       <none>        443/TCP    2d20h
productpage   ClusterIP   10.106.98.129   <none>        9080/TCP   6m57s
ratings       ClusterIP   10.98.209.167   <none>        9080/TCP   6m58s
reviews       ClusterIP   10.106.27.124   <none>        9080/TCP   6m58s
```

#### 访问Bookinfo

```
# kubectl exec -it $(kubectl get pod -l app=ratings -o jsonpath='{.items[0].metadata.name}') -c ratings -- curl productpage:9080/productpage | grep -o "<title>.*</title>"
<title>Simple Bookstore App</title>
```

使用istio-gateway来访问
```
# kubectl apply -f samples/bookinfo/networking/bookinfo-gateway.yaml
# kubectl get gateways.networking.istio.io 
NAME               AGE
bookinfo-gateway   3m34s
```

这里集群没有LoadBalancer, 通过NodePort来访问
```
# export INGRESS_HOST=<本机IP>
# export INGRESS_PORT=$(kubectl -n istio-system get service istio-ingressgateway -o jsonpath='{.spec.ports[?(@.name=="http2")].nodePort}')
# export GATEWAY_URL=$INGRESS_HOST:$INGRESS_PORT

# curl -s http://${GATEWAY_URL}/productpage | grep -o "<title>.*</title>"
<title>Simple Bookstore App</title>
```


#### 清理Bookinfo应用

删除路由规则，删除应用pod
```
# ./samples/bookinfo/platform/kube/cleanup.sh
```

确认应用已删除
```
# kubectl get virtualservices.networking.istio.io 
No resources found in default namespace. 
# kubectl get destinationrules.networking.istio.io 
No resources found in default namespace.
# kubectl get gateways.networking.istio.io 
No resources found in default namespace.
# kubectl get pods
No resources found in default namespace.
```

### 卸载istio

卸载程序将删除 RBAC 权限、istio-system 命名空间和所有相关资源。可以忽略那些不存在的资源的报错，因为它们可能已经被删除掉了。
```
# istioctl manifest generate --set profile=demo | kubectl delete -f -
```

### 参考链接

- [基于Ubuntu 20.04安装Kubernetes 1.18](https://zhuanlan.zhihu.com/p/138554103)
- [istio官方文档-设置Sidecar](https://istio.io/latest/zh/docs/setup/additional-setup/sidecar-injection/#manual-sidecar-injection)
- [istio getting-started](https://istio.io/latest/zh/docs/setup/getting-started/#platform)
