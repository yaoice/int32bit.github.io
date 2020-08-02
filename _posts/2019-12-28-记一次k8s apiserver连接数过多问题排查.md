---
layout: post
title: 记一次k8s apiserver连接数过多问题排查
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

- Kubernetes v1.14.6
- Etcd 3.3.12
- Docker 18.09.9

### 现象

查看不同状态的连接数数量
```
# netstat -ant | awk '/^tcp/ {++y[$NF]} END {for(w in y) print w, y[w]}'
LISTEN 19
ESTABLISHED 1252
TIME_WAIT 17
```
发现有大量的ESTABLISHED连接

查看每个ip跟server建立的连接数
```
# netstat -napto|egrep -v "and|Address" | awk '{print$5}'|awk -F : '{print$1}'|sort|uniq -c|sort -rn
1003 9.14.6.183
```
这个跟ip的连接最多

```
# netstat -napto|grep 9.14.6.183
tcp6       0      0 <本机ip>:6443        9.14.6.183:32820      ESTABLISHED 23876/kube-apiserve  keepalive (86.48/0/0)
```
在9.14.6.183端本地查不到32820端口, 造成这种现象有可能是9.14.6.183客户端断开连接的时候未发送FIN, 导致服务器端还是ESTABLISHED状态;
经过查阅是某个pod的健康检查导致

容器内的/proc/sys/net大多数参数和宿主机的是隔离的

```
# kubectl  logs xxx-pod |grep 32820
2020-01-04 17:51:20.939 info    GET /healthz: (689.599µs) 200 [kube-probe/1.14 9.14.6.183:32820]
```

### 参考链接

- [http://www.178linux.com/2499](http://www.178linux.com/2499)
- [https://toutiao.io/posts/3kziep/preview](https://toutiao.io/posts/3kziep/preview)
- [Linux跟踪连接netfilter调优](https://www.cnblogs.com/xiangsikai/p/9525287.html)
- [Using sysctls in a Kubernetes Cluster](https://kubernetes-io-vnext-staging.netlify.com/docs/tasks/administer-cluster/sysctl-cluster/#enabling-unsafe-sysctls)
