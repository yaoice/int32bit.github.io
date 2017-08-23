---
layout: post
title: 快速体验kubernetes
subtitle: ""
catalog: true
tags:
     - k8s
---

## 背景

因为天朝GFW的缘故，导致国内搭建k8s集群不易. 又想快速体验k8s，怎么办？[Play with Kubernetes](http://labs.play-with-k8s.com/)提供了一个免费的Kubernets体验环境，每次创建集群的最长使用时间是4小时。

### Play with Kubernets

打开[Play with Kubernetes](http://labs.play-with-k8s.com/)，界面看起来挺酷的！按照提示，就三条命令，安装k8s集群。

  <img src="/img/posts/2017-08-16/1.png" width="1000" height="700" />

初始化k8s master节点

      kubeadm init --apiserver-advertise-address $(hostname -i)

初始化集群网络（这里用weave）

      kubectl apply -n kube-system -f \
            "https://cloud.weave.works/k8s/net?k8s-version=$(kubectl version | base64 |tr -d '\n')"

安装k8s dashboard（可选）

      curl -L -s https://git.io/kube-dashboard  | sed 's/targetPort: 9090/targetPort: 9090\n  type: LoadBalancer/' | kubectl apply -f -

如果想调度pod在master节点，否则则不需要执行

      kubectl taint nodes --all node-role.kubernetes.io/master-


## 体验Dashboard

安装完dashboard后，IP地址旁边会出现一个端口的链接.

<img src="/img/posts/2017-08-16/2.png" width="1000" height="700" />

中文的k8s dashboard，看起来还挺不错的！

<img src="/img/posts/2017-08-16/3.png" width="1000" height="700" />


## 从dashoard创建一个应用

创建nginx应用

<img src="/img/posts/2017-08-16/4.png" width="1000" height="500" />

查看应用

<img src="/img/posts/2017-08-16/5.png" width="1000" height="500" />


## 集成helm

helm简介看这里：[http://blog.fleeto.us/content/helm-jian-jie](http://blog.fleeto.us/content/helm-jian-jie)

下载安装helm

    wget -c https://kubernetes-helm.storage.googleapis.com/helm-v2.5.1-linux-amd64.tar.gz
    tar xf helm-v2.5.1-linux-amd64.tar.gz
    cp linux-amd64/helm  /usr/bin/

开启ipv6, 默认CentOS 7禁用ipv6

    echo "net.ipv6.conf.all.disable_ipv6=0" >> /etc/sysctl.conf
    sysctl -p

初始化Helm并安装Tiller服务（需要配置好kubeclt）

    helm init

更新charts repo列表

    helm repo update

列出所有的release（如果出现如下错误）

    helm list
    Error: User "system:serviceaccount:kube-system:default" cannot list configmaps in the namespace "kube-system". (get configmaps)

上面错误的解决方法（k8s的rbac问题）

    kubectl create serviceaccount --namespace kube-system tiller
    kubectl create clusterrolebinding \
          tiller-cluster-rule \
          --clusterrole=cluster-admin \
          --serviceaccount=kube-system:tiller
    kubectl patch deploy --namespace kube-system \
              tiller-deploy \
              -p '{"spec":{"template":{"spec":{"serviceAccount":"tiller"}}}}'

helm安装mysql charts

    [node1 ~]$ helm install stable/mysql
    LAST DEPLOYED: Wed Aug 16 13:09:33 2017
    NAMESPACE: default
    STATUS: DEPLOYED

    RESOURCES:
    ==> v1/Secret
    NAME               TYPE    DATA  AGE
    fuzzy-whale-mysql  Opaque  2     1s

    ==> v1/PersistentVolumeClaim
    NAME               STATUS   VOLUME  CAPACITY  ACCESSMODES  STORAGECLASS  AGE
    fuzzy-whale-mysql  Pending  1s

    ==> v1/Service
    NAME               CLUSTER-IP     EXTERNAL-IP  PORT(S)   AGE
    fuzzy-whale-mysql  10.99.214.187  <none>       3306/TCP  1s

    ==> v1beta1/Deployment
    NAME               DESIRED  CURRENT  UP-TO-DATE  AVAILABLE  AGE
    fuzzy-whale-mysql  1        1        1           0          1s


    NOTES:
    MySQL can be accessed via port 3306 on the following DNS name from within your cluster:
    fuzzy-whale-mysql.default.svc.cluster.local

    To get your root password run:

      kubectl get secret --namespace default fuzzy-whale-mysql -o jsonpath="{.data.mysql-root-password}" | base64 --decode; echo

    To connect to your database:

    1. Run an Ubuntu pod that you can use as a client:

      kubectl run -i --tty ubuntu --image=ubuntu:16.04 --restart=Never -- bash -il

    2. Install the mysql client:

      $ apt-get update && apt-get install mysql-client -y

    3. Connect using the mysql cli, then provide your password:
      $ mysql -h fuzzy-whale-mysql -p

好了， k8s集群、helm体验就到此为止了！

## 在线k8s训练营

来自网易的在线k8s训练营[http://k8s.bingohuang.com/](http://k8s.bingohuang.com/)，非常适合新手入门，内容包括：

- 集群创建
- 应用部署
- 应用探索
- 应用发布
- 应用扩容
- 应用升级


## 参考链接

[https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/](https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/)
