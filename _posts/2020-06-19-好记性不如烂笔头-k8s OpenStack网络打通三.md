---
layout: post
title: 好记性不如烂笔头
subtitle: k8s、OpenStack网络打通(三)
catalog: true
tags:
     - k8s
---

继上篇[k8s、OpenStack网络打通(二)](http://www.iceyao.com.cn/2020/05/06/%E5%A5%BD%E8%AE%B0%E6%80%A7%E4%B8%8D%E5%A6%82%E7%83%82%E7%AC%94%E5%A4%B4-k8s-OpenStack%E7%BD%91%E7%BB%9C%E6%89%93%E9%80%9A%E4%B8%80/) 
cni ipam已经实现了从neutron分配ip, 如果是在K8s、OpenStack融合的场景下(即k8s部署在OpenStack VM中)，neutron port是跟VM关联的，要想VM下的pod
能够通信，有两种方式：

ipvlan模式

<img src="/img/posts/2020-06-19/ipvlan-l2-veth.png"/>

### 参考链接

- [https://kubernetes.io/docs/concepts/architecture/cloud-controller/#service-controller](https://kubernetes.io/docs/concepts/architecture/cloud-controller/#service-controller)
- [Kubernetes网络的IPVlan方案](https://kernel.taobao.org/2019/11/ipvlan-for-kubernete-net/)
