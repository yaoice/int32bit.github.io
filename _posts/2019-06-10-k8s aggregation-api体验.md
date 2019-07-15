---
layout: post
title: K8s Aggregation API体验
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

- OS: CentOS 7.5
- Kubernetes v1.11.6
- Etcd 3.3.10
- Docker 1.13.1

### 什么是Aggregation API

Aggregation API和crd都可以在不修改k8s核心代码前提下，并扩展k8s api，是一种实现方式.


### 什么时候考虑用Aggregation API

|  考虑使用Aggregation API    |  考虑使用stand-alone API    | 
| :----  | :---- | 
| Your API is Declarative.	| Your API does not fit the Declarative model. |
|  You want your new types to be readable and writable using kubectl. |	kubectl support is not required |
|  You want to view your new types in a Kubernetes UI, such as dashboard, alongside built-in types.	| Kubernetes UI support is not required.
|  You are developing a new API.	 | You already have a program that serves your API and works well.
|  You are willing to accept the format restriction that Kubernetes puts on REST resource paths, such as API Groups and Namespaces. (See the API Overview.)	| You need to have specific REST paths to be compatible with an already defined REST API.
|  Your resources are naturally scoped to a cluster or to namespaces of a cluster.	| Cluster or namespace scoped resources are a poor fit; you need control over the specifics of resource paths.
|  You want to reuse Kubernetes API support features.	| You don’t need those features.



### CRD和Aggregation API差异对比

易用程度、高级功能及灵活性、公共点：

见[https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/)


### demo操作

kube-apiserver增加如下配置：

```
--requestheader-client-ca-file=/etc/kubernetes/ssl/ca.pem
--proxy-client-cert-file=/etc/kubernetes/ssl/admin.pem
--proxy-client-key-file=/etc/kubernetes/ssl/admin-key.pem
```

如果kube-proxy没在master上运行，增加如下配置

```
--enable-aggregator-routing=true
```

用sample-apiserver这个项目来体验Aggregation API，此外apiserver-builder也可以生成Aggregation API的框架

```
mkdir -p $GOPATH/src/k8s.io/
cd $GOPATH/src/k8s.io/
```

克隆项目
```
git clone https://github.com/kubernetes/sample-apiserver.git
cd sample-apiserver
go mod vendor
```

编译
```
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -o artifacts/simple-image/kube-sample-apiserver
```

编译镜像
```
docker build -t kube-sample-apiserver ./artifacts/simple-image
```

In-cluster部署
```
kubectl apply -f artifacts/example
```

查看Aggregation API是否生效
```
kubectl get apiservices.apiregistration.k8s.io 
```

验证
```
kubectl apply -f  artifacts/flunders/01-flunder.yaml
kubectl get flunders.wardle.k8s.io 
``` 

### 参考链接

- [CRD VS Aggregation API](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/)
- [sample-apiserver](https://github.com/kubernetes/sample-apiserver)
- [apiserver-builder](https://github.com/kubernetes-incubator/apiserver-builder-alpha/tree/master)
- [https://kubernetes.feisky.xyz/cha-jian-kuo-zhan/api/aggregation](https://kubernetes.feisky.xyz/cha-jian-kuo-zhan/api/aggregation)