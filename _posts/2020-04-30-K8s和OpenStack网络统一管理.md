---
layout: post
title: K8s和OpenStack网络统一管理
subtitle: ""
catalog: true
tags:
     - k8s
---

### 一、背景

在OpenStack网络下，默认虚拟机端口都开启了防arp欺骗功能；再加上在虚拟机里部署k8s集群，又跑了一层
overlay网络，网络开销又增大了；实际上我们很多时候想网络统一管理，即虚拟机网络和容器网络在同一平面上.

### 二、可选方案

对于k8s网络来说，pod想用到虚拟机同一平面的网络，那就是让pod使用underlay的网络，典型的underlay网络有
bridge、ipvlan、macvlan等；还要考虑兼容TCNP现有网络模型，保留k8s service的特性，使用kube apiserver代理
能够访问集群内部service的功能；

#### 方案一 - k8s网络使用underlay网络

对现有应用需大量改造，应用内部大量使用内部service机制来调用其它服务，不兼容旧模型，pod使用的是underlay网络，
性能卓越. 

工作量：
- 开发一个基于neutron的cni ipam plugin

#### 方案二 - k8s网络使用多种cni

k8s master运行flannel(overlay)的cni，保留通过kube apiserver代理访问集群内部service的功能；
k8s node运行ipvlan或macvlan+ptp的cni, node节点同时加载两个cni插件，ptp cni的作用是创建一对veth，
连接pod和宿主机，并设置条路由，可以实现pod也能访问k8s service.

工作量：
- 开发一个基于neutron的cni ipam plugin
- 开发ptp cni插件

#### 最终选择

方案一
优点：
- 一套集群运行一种cni插件
缺点：
- pod网络模型单一，丧失了k8s service特性
- 不兼容原来应用部署模式，也不兼容现有TCNP网络模型

方案二
优点：
- 兼容现有TCNP网络模型，保留了k8s service特性
缺点：
- 一套集群运行了三种cni插件
- 开发工作量相比较多

建议方案二

### 三、设计




### 四、性能测试




### 五、结论



### 六、参考链接

- [https://github.com/lyft/cni-ipvlan-vpc-k8s/blob/master/plugin/unnumbered-ptp/unnumbered-ptp.go](https://github.com/lyft/cni-ipvlan-vpc-k8s/blob/master/plugin/unnumbered-ptp/unnumbered-ptp.go)
