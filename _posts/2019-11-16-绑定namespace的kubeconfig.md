---
layout: post
title: 绑定namespace的kubeconfig
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

- Kubernetes v1.14.6
- Etcd 3.3.12
- Docker 18.09.9

### k8s中的用户

k8s中的用户有serviceaccount和user

- serviceaccount是k8s管理
- user不受k8s管理，k8s可以控制该用户在集群内的权限

### 创建ice用户

用户名为ice

1. 为ice用户创建私钥
   ```
   openssl genrsa -out ice.key 2048
   ```
2. 用此私钥创建证书签名请求文件(csr)
   ```
   openssl req -new -key ice.key -out ice.csr -subj "/CN=ice/O=MGM"
   ```
3. 利用集群的CA证书(/etc/kubernetes/pki/)和csr文件，为ice用户颁发证书   
   ```
   openssl x509 -req -in ice.csr \
        -CA /etc/kubernetes/pki/ca.crt \
        -CAkey /etc/kubernetes/pki/ca.key \
        -CAcreateserial \
        -out ice.crt \
        -days 3650
   ```
4. 为ice用户添加rbac
   
   创建ice命名空间
   ```
   kubectl create namespace ice
   ```

   创建roleBing
   ```
   root@10.10.10.12:~# vim ice-rolebind.yaml
   kind: RoleBinding
   apiVersion: rbac.authorization.k8s.io/v1beta1
   metadata:
     name: admin-binding
     namespace: ice
   subjects:
   - kind: User
     name: ice
     apiGroup: ""
   roleRef:
     kind: ClusterRole
     name: admin
     apiGroup: ""
   ```
   k8s内置admin、cluster-admin的clusterRole; 所有命名空间的管理员用cluster-admin,
   某一命名空间的管理员用admin.
   
   应用rbac
   ```
   kubectl apply -f ice-rolebind.yaml
   ```
   
### 创建kubeconfig

   设置集群参数
   ```
   export KUBE_APISERVER="https://127.0.0.1:6443"
   kubectl config set-cluster kubernetes \
        --certificate-authority=/etc/kubernetes/pki/ca.crt \
        --embed-certs=true --server=${KUBE_APISERVER} \
        --kubeconfig=ice.kubeconfig
   ```    

   设置认证参数
   ```
   kubectl config set-credentials ice \
        --client-certificate=ice.crt \
        --client-key=ice.key \
        --embed-certs=true \
        --kubeconfig=ice.kubeconfig
   ```

   设置context参数
   ```
   kubectl config set-context kubernetes \
        --cluster=kubernetes \
        --user=ice \
        --namespace=ice \
        --kubeconfig=ice.kubeconfig
   ```
   
   设置默认context
   ```
   kubectl config use-context kubernetes --kubeconfig=ice.kubeconfig 
   ```  

### 测试验证

   ```
   root@10.10.10.12:~# kubectl --kubeconfig=ice.kubeconfig get namespaces
   Error from server (Forbidden): namespaces is forbidden: User "ice" cannot list resource "namespaces" in API group "" at the cluster scope
   
   root@10.10.10.12:~# kubectl --kubeconfig=ice.kubeconfig get pod
   No resources found.
   ```
   只能在ice命名空间下操作

### 参考链接

- [为Kubernetes集群添加用户](https://zhuanlan.zhihu.com/p/43237959)
- [创建用户认证授权的kubeconfig文件](https://www.zrq.org.cn/post/%E5%88%9B%E5%BB%BA%E7%94%A8%E6%88%B7%E8%AE%A4%E8%AF%81%E6%8E%88%E6%9D%83%E7%9A%84kubeconfig%E6%96%87%E4%BB%B6/)