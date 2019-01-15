---
layout: post
title: Kubernetes编写自定义controller
subtitle: ""
catalog: true
tags:
     - k8s
---

### 简介

client-go是kubernetes官方的一个通用库，通过它可以很容易实现自定义controller.

关于如何使用client-go，参考徐超大神的分享：[使用 client-go 控制原生及拓展的 Kubernetes API](https://www.kubernetes.org.cn/1309.html)


### client-go架构设计

来自kubernetes github的一张图

<img src="/img/posts/2019-01-15/1.png" width="500" height="500" />


### 参考链接

- [kubernetes ingress自定义controller简易实现](https://github.com/meyskens/k8s-openresty-ingress)
- [如何用 client-go 拓展 Kubernetes 的 API](https://mp.weixin.qq.com/s?__biz=MzU1OTAzNzc5MQ==&mid=2247484052&idx=1&sn=cec9f4a1ee0d21c5b2c51bd147b8af59&chksm=fc1c2ea4cb6ba7b283eef5ac4a45985437c648361831bc3e6dd5f38053be1968b3389386e415&scene=21#wechat_redirect)
