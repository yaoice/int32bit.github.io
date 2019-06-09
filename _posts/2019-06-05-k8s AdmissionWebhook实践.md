---
layout: post
title: K8s AdmissionWebhook实践
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

### 什么是AdmissionWebhook

什么是AdmissionWebhook，就要先了解k8s中的admission controller, 按照官方的解释是：
admission controller是拦截(经过身份验证)API Server请求的网关，并且可以修改请求对象或拒绝请求。

简而言之，它可以认为是拦截器，类似web框架中的middleware。

k8s默认提供很多内置的admission controller，通过kube-apiserver启动命令参数可以
查看到支持的admission controller plugin有哪些。

```
[root@node220]# kube-apiserver --help |grep enable-admission-plugins

# 支持的plugin有如下
AlwaysAdmit, AlwaysDeny, AlwaysPullImages, 
DefaultStorageClass, DefaultTolerationSeconds, DenyEscalatingExec, 
DenyExecOnPrivileged, EventRateLimit, ExtendedResourceToleration, 
ImagePolicyWebhook, Initializers, LimitPodHardAntiAffinityTopology, 
LimitRanger, MutatingAdmissionWebhook, NamespaceAutoProvision, 
NamespaceExists, NamespaceLifecycle, NodeRestriction, 
OwnerReferencesPermissionEnforcement, PersistentVolumeClaimResize, 
PersistentVolumeLabel, PodNodeSelector, PodPreset, PodSecurityPolicy, 
PodTolerationRestriction, Priority, ResourceQuota, SecurityContextDeny, 
ServiceAccount, StorageObjectInUseProtection, ValidatingAdmissionWebhook. 
```

这里enable的admission-plugins如下
```
--enable-admission-plugins=PersistentVolumeClaimResize,NamespaceLifecycle,LimitRanger,ServiceAccount,DefaultStorageClass,ResourceQuota,NodeRestriction,ValidatingAdmissionWebhook,MutatingAdmissionWebhook 
```

这里不对每个plugin详细说明，网上都可以搜到相关资料。 总体来说，admission-plugins分为三大类：

1. 修改类型(mutating)
2. 验证类型(validating)
3. 既是修改又是验证类型(mutating&validating)

这些admission plugin构成一个顺序链，先后顺序决定谁先调用，但不会影响使用。这里关心的plugin有两个：

一. MutatingAdmissionWebhook, ValidatingAdmissionWebhook

- MutatingAdmissionWebhook: 做修改操作的AdmissionWebhook
- ValidatingAdmissionWebhook: 做验证操作的AdmissionWebhook

引用kubernetes官方博客的一张图来说明MutatingAdmissionWebhook和ValidatingAdmissionWebhook所处的位置:
   
<img src="/img/posts/2019-06-05/1.png" width="1200" height="800" />
   
   解释下这个过程：
   1. api请求到达K8s API Server
   2. 请求要先经过认证
      - kubectl调用需要kubeconfig
      - 直接调用K8s api需要证书+bearToken
      - client-go调用也需要kubeconfig
   3. 执行一连串的admission controller，包括MutatingAdmissionWebhook和ValidatingAdmissionWebhook,
      先串行执行MutatingAdmission的Webhook list
   4. 对请求对象的schema进行校验   
   5. 并行执行ValidatingAdmission的Webhook list
   6. 最后写入etcd

二. Initializers vs AdmissionWebhook区别

二者都能实现动态可扩展载入admission controller， Initializers是串行执行，在高并发场景容易导致对象停留在uninitialized状态，影响继续调度。
Alpha Initializers特性在k8s 1.14版本被移除了，详情见[https://github.com/kubernetes/apimachinery/issues/60](https://github.com/kubernetes/apimachinery/issues/60)。
相比Initializers，官方更推荐AdmissionWebhook；MutatingAdmissionWebhook是串行执行，ValidatingAdmissionWebhook是并行执行，性能更好。


### AdmissionWebhook应用场景

Istio相信大家都有听过，istio就是采用AdmissionWebhook实现sidecar容器自动注入。我目前用到的应用场景有两个，当然肯定还有其它应用场景。

- 自动打标签

    比如启动一个应用，应用包括deployment、service、ingress；
    怎么快速过滤出哪些资源属于应用? 在k8s中，pod、service、ingress
    都是独立的资源，通过给这些资源打上label，是最快速的方式。

    
- 自动注入sidecar容器
    
    应用启动后，应用的监控、日志如何处理？借助sidecar容器注入到其pod中


收集应用日志的sidecar容器如下图所示，应用监控的sidecar容器类似
    
<img src="/img/posts/2019-06-05/2.png" width="500" height="400" />
    

### AdmissionWebhook demo

进入实战阶段，git clone [demo例子](https://github.com/yaoice/webhook-demo)实现自动打标签+sidecar自动注入的功能

利用脚本(istio团队提供的)生成CertificateSigningRequest，再生成secret(给后面的webhook-api使用)
```
./deployment/webhook-create-signed-cert.sh 
```

利用脚本生成mutatingwebhook和validatingwebhook yaml，变量CA_BUNDLE自动从kubeconfig中获取
```
cat ./deployment/validatingwebhook.yaml | ./deployment/webhook-patch-ca-bundle.sh > ./deployment/validatingwebhook-ca-bundle.yaml
cat ./deployment/mutatingwebhook.yaml | ./deployment/webhook-patch-ca-bundle.sh > ./deployment/mutatingwebhook-ca-bundle.yaml  
```

编译镜像
```
docker build --rm -t test/admission-webhook-example:v1 -f docker/Dockerfile .
```

部署webhook-api
```
kubectl apply -f ./deployment/mutatingwebhook-ca-bundle.yaml 
kubectl apply -f ./deployment/validatingwebhook-ca-bundle.yaml
kubectl apply -f configmap.yaml
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f nginxconfigmap.yaml   # 这里sidecar是nginx, sidecar依赖的configmap
```

给default命名空间打label
```
kubectl label namespace default admission-webhook-example=enabled
```

部署一个busybox，sidecar是nginx
```
kubectl apply -f ./deployment/sleep.yaml

kubectl get pod sleep-5588cb5f94-5dl8f --show-labels 
NAME                     READY     STATUS    RESTARTS   AGE       LABELS
sleep-5588cb5f94-5dl8f   2/2       Running   0          27s       app.kubernetes.io/name=not_available,app=sleep,pod-template-hash=1144761950 

kubectl get svc sleep --show-labels 
NAME      TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE       LABELS
sleep     ClusterIP   10.68.4.5    <none>        80/TCP    4m        app.kubernetes.io/name=not_available

kubectl get ingresses.extensions sleep --show-labels 
NAME      HOSTS          ADDRESS   PORTS     AGE       LABELS
sleep     xx.sleep.com             80        4m        app.kubernetes.io/name=not_available
```

### 开发调试 

如果K8s装在远端Server上，在本地如何调试？ 

1. 在goland中启动webhook api, 监听在本地6443

    <img src="/img/posts/2019-06-05/4.png" width="800" height="600" />


2. 利用ssh反向代理

    ```
    ssh -R 6443:127.0.0.1:6443 root@<k8s-master-ip>
    ```
    
    监听在K8s Server上的6443，会重定向到本地的6443


3. 利用K8s headless service指向k8s-master-ip的6443

    ```
    [root@node66 ~]# cat /data/deployment/service.yaml 
    apiVersion: v1
    kind: Service
    metadata:
      name: admission-webhook-example-svc
    spec:
      ports:
      - port: 443
        targetPort: 6443
    
    ---
    apiVersion: v1
    kind: Endpoints
    metadata:
      name: admission-webhook-example-svc
    subsets:
      - addresses:
          - ip: <k8s-master-ip>
        ports:
          - port: 6443
    ```

执行上述操作步骤后，在本地就可以设置断点调试了

### 发散思维

#### AdmissionWebhook多集群应用

如果有多个k8s集群，那是不是要在每个集群都启动一个Webhook API呢？所以就有了下面的架构，所有集群共享
一个Webhook API。
<img src="/img/posts/2019-06-05/3.png" width="800" height="600" />
 
cluster c1、c2中的Webhook配置会指向各自集群内部的service，这个service其实是headless service，
它指向的是cluster A的service(需要暴露给其它集群能够访问，nodePort也可以)，这样所有集群就共享一个Webhook API了。

### 总结

AdmissionWebhook可以像拦截器一样拦截K8s api请求，要实现修改用MutatingAdmissionWebhook，
实现验证ValidatingAdmissionWebhook。

写一个AdmissionWebhook API的要点：
1. AdmissionReview结构体
    request请求信息通过AdmissionReview的Request字段可以获取到；
    response通过AdmissionReview的Response字段设置返回
    
    ```
    // AdmissionReview describes an admission review request/response.
    type AdmissionReview struct {
        metav1.TypeMeta `json:",inline"`
        // Request describes the attributes for the admission request.
        // +optional
        Request *AdmissionRequest `json:"request,omitempty" protobuf:"bytes,1,opt,name=request"`
        // Response describes the attributes for the admission response.
        // +optional
        Response *AdmissionResponse `json:"response,omitempty" protobuf:"bytes,2,opt,name=response"`
    }
    ```

2. mutating是通过[json patch](https://tools.ietf.org/html/rfc6902#appendix-A.2)方式实现的

    对应的结构体定义如下： 
    ```
    type patchOperation struct {
      Op    string      `json:"op"`
      Path  string      `json:"path"`
      Value interface{} `json:"value,omitempty"`
    }
    
    patches = append(patches, patchOperation{
      Op:    "add",
      Path: "/metadata/annotations",
      Value: true,
    })
    ```



### 参考链接

- [https://github.com/morvencao/kube-mutating-webhook-tutorial](https://github.com/morvencao/kube-mutating-webhook-tutorial)
- [https://github.com/banzaicloud/admission-webhook-example](https://github.com/banzaicloud/admission-webhook-example)
- [https://banzaicloud.com/blog/k8s-admission-webhooks/](https://banzaicloud.com/blog/k8s-admission-webhooks/)
- [https://kubernetes.io/blog/2019/03/21/a-guide-to-kubernetes-admission-controllers/](https://kubernetes.io/blog/2019/03/21/a-guide-to-kubernetes-admission-controllers/)
- [JSON Patch](http://atbug.com/json-patch/#%E7%AE%80%E5%8D%95%E7%9A%84%E4%BE%8B%E5%AD%90)
