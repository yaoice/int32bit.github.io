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
SYN_RECV 1
ESTABLISHED 590
TIME_WAIT 16
```

查看每个ip跟server建立的连接数
```
netstat -napto|egrep -v "and|Address" | awk '{print$5}'|awk -F : '{print$1}'|sort|uniq -c|sort -rn
```

### 参考链接
