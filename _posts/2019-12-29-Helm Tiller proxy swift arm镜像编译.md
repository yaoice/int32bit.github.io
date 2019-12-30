---
layout: post
title: 记一次tiller proxy swift和tiller版本兼容性问题
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

- Kubernetes v1.14.6
- Etcd 3.3.12
- Docker 18.09.9
- Swift 0.9.0
- Tiller v2.10.0

### 简介

swift是helm tiller的proxy, 负责把grpc请求转为rest http请求

### 现象

chart大小超过4M，swift获取release列表就有问题；不通过swift，以harbor chart为例，来重现这个问题

原始chart大小不超过4M
```
# du -sh harbor/
336K    harbor/
```

创建一个4M的文件
```
# fallocate -l 4M harbor/test
# du -sh harbor/
4.4M    harbor/
```

部署
```
# helm install -n harbor harbor/
# helm ls
NAME    REVISION        UPDATED                         STATUS          CHART           APP VERSION  NAMESPACE
harbor  1               Mon Dec 30 09:54:14 2019        DEPLOYED        harbor-1.0.0    1.7.0        default  
```
helm ls是直接通过grpc跟tiller通信的，正常

验证调用swift api，通过k8s apiserver proxy的方式获取所有命名空间的release列表
```
# export TOKEN=`awk '/token/ {print $2}' ~/.kube/config`
# export SERVER=`awk '/server/ {print $2}' ~/.kube/config`

# curl -X GET $SERVER/api/v1/namespaces/kube-system/services/helm-api:http/proxy/tiller/v2/releases/json?all=true \
    --header "Authorization: Bearer $TOKEN" \
    --cacert /etc/kubernetes/pki/ca.crt 
{"code":8,"message":"grpc: received message larger than max (4639744 vs. 4194304)"} 
```
调用失败，返回grpc接收的message超过最大值(4194304), 4194304 / 1024 / 1024 = 4M，问题应该出在swift上


### 分析

确认下版本，swift是0.9.0, helm tiller是2.10.0, 按照官网版本版本对应的关系是:

| Swift Version                                                     | Helm/Tiller Version |
|-------------------------------------------------------------------|---------------------|
| [v0.12.1](https://github.com/kubepack/swift/releases/tag/v0.12.1) | 2.14.0              |
| [0.11.1](https://github.com/kubepack/swift/releases/tag/0.11.1)   | 2.13.0              |
| [0.10.0](https://github.com/kubepack/swift/releases/tag/0.10.0)   | 2.12.0              |
| [0.9.0](https://github.com/kubepack/swift/releases/tag/0.9.0)     | 2.11.0              |
| [0.8.1](https://github.com/kubepack/swift/releases/tag/0.8.1)     | 2.9.0               |
| [0.7.3](https://github.com/kubepack/swift/releases/tag/0.7.3)     | 2.8.0               |
| [0.5.2](https://github.com/kubepack/swift/releases/tag/0.5.2)     | 2.7.0               |
| [0.3.2](https://github.com/kubepack/swift/releases/tag/0.3.2)     | 2.5.x, 2.6.x        |
| [0.2.0](https://github.com/kubepack/swift/releases/tag/0.2.0)     | 2.5.x, 2.6.x        |
| [0.1.0](https://github.com/kubepack/swift/releases/tag/0.1.0)     | 2.5.x, 2.6.x        |
链接地址: [https://github.com/kubepack/swift](https://github.com/kubepack/swift)

swift 0.9.0版本对应的tiller版本是2.11.0

查阅helm v2.10.0版本代码，发现tiller已经支持20M, grpc接收/发送默认大小是4M.
commit链接 [fix(grpc): Fixes issue where message sending limited to 4mb](https://github.com/helm/helm/pull/3469/commits/614cd9dfe7413a3b8624311bebaf8e8229b05e3f)
```
// maxMsgSize use 20MB as the default message size limit.
// grpc library default is 4MB
var maxMsgSize = 1024 * 1024 * 20

// DefaultServerOpts returns the set of default grpc ServerOption's that Tiller requires.
func DefaultServerOpts() []grpc.ServerOption {
	return []grpc.ServerOption{
		grpc.MaxRecvMsgSize(maxMsgSize),
		grpc.MaxSendMsgSize(maxMsgSize),
		grpc.UnaryInterceptor(newUnaryInterceptor()),
		grpc.StreamInterceptor(newStreamInterceptor()),
	}
}
```

查阅swift 0.9.0版本代码, 发现grpc没设置接收大小，默认就是4M了
```
opts := []grpc.DialOption{
        grpc.WithBlock(), // required for timeout 
        grpc.WithUnaryInterceptor(grpc_glog.UnaryClientInterceptor(glogEntry, optsGLog...)),
        grpc.WithStreamInterceptor(grpc_glog.StreamClientInterceptor(glogEntry, optsGLog...)),
}
```
代码链接：[https://github.com/kubepack/swift/blob/0.9.0/pkg/connectors/common.go#L37](https://github.com/kubepack/swift/blob/0.9.0/pkg/connectors/common.go#L37)

查阅swift 0.11.1版本代码, 已经设置grpc接收大小为20M了
```
maxReceiveMsgSize = 1024 * 1024 * 20
opts := []grpc.DialOption{
        grpc.WithBlock(), // required for timeout
        grpc.WithUnaryInterceptor(grpc_glog.UnaryClientInterceptor(glogEntry, optsGLog...)),
        grpc.WithStreamInterceptor(grpc_glog.StreamClientInterceptor(glogEntry, optsGLog...)),
        grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(maxReceiveMsgSize)),
}
```

### 更新验证

tiller镜像更新到gcr.io/kubernetes-helm/tiller:v2.13.0, swift镜像更新到appscode/swift:0.11.1

调用swift api

获取所有命名空间的release
```
# curl -X GET $SERVER/api/v1/namespaces/kube-system/services/helm-api:http/proxy/tiller/v2/releases/json?all=true \
    --header "Authorization: Bearer $TOKEN" \
    --cacert /etc/kubernetes/pki/ca.crt 
```
正常返回

获取指定命名空间的release
```
# curl -X GET $SERVER/api/v1/namespaces/kube-system/services/helm-api:http/proxy/tiller/v2/releases/json?namespace=ceph \
    --header "Authorization: Bearer $TOKEN" \
    --cacert /etc/kubernetes/pki/ca.crt 
{"code":13,"message":"runtime error: invalid memory address or nil pointer dereference"}
```
看到这个返回，以为是个报错，实际上是因为该命名空间下没有release

### 参考链接

- [swift api](https://github.com/kubepack/swift/blob/master/docs/guides/api.md)
- [Helm架构与中心化部署解决方案](https://youendless.com/post/helm_design/)