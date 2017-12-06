---
layout: post
title: Kubeadm安装Kubernetes 1.8.4
subtitle: ""
catalog: true
tags:
     - k8s
---

## 背景

kubeadm是kubernetes官方提供的快速安装k8s集群工具，kubeadm部署出来的集群不是高可用的，所以目前kubeadm一般不用于生产环境。


### 环境

- CentOS 7.3
- docker-ce-17.11.0.ce-1.el7.centos.x86_64
- kubectl-1.8.4-0.x86_64
- kubeadm-1.8.4-0.x86_64
- kubelet-1.8.4-0.x86_64
- kubernetes-cni-0.5.1-1.x86_64

### 系统配置

  单节点，静态主机名解析

    [root@master ~]# cat /etc/hosts  
    172.19.0.14 master

  禁用防火墙和selinux

    [root@master ~]# systemctl stop firewalld     
    [root@master ~]# systemctl disable firewalld

    [root@master ~]# setenforce 0
    [root@master ~]# vim /etc/selinux/config
    SELINUX=disabled

  k8s从1.8版本开始kubelet要求关闭系统swap,不然无法启动；可以通过kubelet的启动参数--fail-swap-on=false更改这个限制。

    [root@master ~]# swapoff -a  # 关闭系统swap

  编辑/etc/fstab,禁用swap分区的挂载

    [root@master ~]# free -m   # 可用free -m查看swap是否关闭
                  total        used        free      shared  buff/cache   available
    Mem:            992         564          72           1         355         255
    Swap:             0           0           0

  swappiness参数调整

    [root@master ~]# vim /etc/sysctl.d/k8s.conf   # 添加如下内容
    vm.swappiness=0

    [root@master ~]# sysctl -p /etc/sysctl.d/k8s.conf  # 使之生效


### 安装docker

  安装相关依赖包

    [root@master ~]# yum install -y yum-utils device-mapper-persistent-data lvm2

  添加docker stable版本的repo

    root@master ~]# yum-config-manager --add-repo \
        https://download.docker.com/linux/centos/docker-ce.repo

  如果想安装最新版docker的话，就采用这个

    [root@master ~]# curl -fsSL "https://get.docker.com/" | sh

  安装docker包

    [root@master ~]# yum install -y docker-ce docker-ce-selinux  

  docker从1.13版本开始禁用iptables filter表中的FOWARD链，这样会导致k8s集群跨Node的Pod无法通信

    [root@master ~]# vim /usr/lib/systemd/system/docker.service # 编辑docker systemd文件，在ExecStart上面加入ExecStartPost命令
    ExecStartPost=/usr/sbin/iptables -P FORWARD ACCEPT
    ExecStart=。。。。。。

  启动docker服务

    [root@master ~]# systemctl daemon-reload
    [root@master ~]# systemctl enable docker
    [root@master ~]# systemctl start docker


### 安装kubeadm、kubelet、kubectl

  添加kubernetes repo源

    [root@master ~]# cat <<EOF > /etc/yum.repos.d/kubernetes.repo
    [kubernetes]
    name=Kubernetes
    baseurl=https://packages.cloud.google.com/yum/repos/kubernetes-el7-x86_64
    enabled=1
    gpgcheck=1
    repo_gpgcheck=1
    gpgkey=https://packages.cloud.google.com/yum/doc/yum-key.gpg
            https://packages.cloud.google.com/yum/doc/rpm-package-key.gpg
    EOF

  测试k8s repo地址是否可用，不然可能需要想办法了。

    [root@master ~]# curl https://packages.cloud.google.com/yum/repos/kubernetes-el7-x86_64

  安装kubelet kubeadm kubectl包

    [root@master ~]# yum install -y kubelet kubeadm kubectl

  kubelet服务开机自启动

    [root@master ~]# systemctl enable kubelet.service

  注：kubelet启动时带的cgroup-driver参数(默认cgroup)和docker使用的cgroup-driver参数(默认cgroup)有所不同，会导致kubelet服务启动失败，因为kubeadm包装出来的配置文件中cgroup-driver为systemd，所以这里选择修改docker cgroup-driver为systemd

    [root@master ~]# rpm -ql kubeadm-1.8.4-0.x86_64
    /etc/systemd/system/kubelet.service.d/10-kubeadm.conf
    /usr/bin/kubeadm

    [root@master ~]# cat /etc/systemd/system/kubelet.service.d/10-kubeadm.conf
    [Service]
    Environment="KUBELET_CGROUP_ARGS=--cgroup-driver=systemd"

    [root@master ~]# vim /etc/docker/daemon.json
    {
      "exec-opts": ["native.cgroupdriver=systemd"]
    }

  重启docker服务

    [root@master ~]# systemctl restart docker
    [root@master ~]# systemctl status docker


### kubeadm创建集群

  这里选用flannel网络插件，还需要改些bridge参数

    [root@master ~]# vim /etc/sysctl.d/k8s.conf  # 添加如下内容
    net.bridge.bridge-nf-call-ip6tables = 1
    net.bridge.bridge-nf-call-iptables = 1

    [root@master ~]# sysctl -p /etc/sysctl.d/k8s.conf  # 使之生效

  初始化集群

    [root@master ~]# kubeadm init  --kubernetes-version=v1.8.4 \
                  --pod-network-cidr=10.244.0.0/16 \ --apiserver-advertise-address=172.19.0.14
    [kubeadm] WARNING: kubeadm is in beta, please do not use it for production clusters.
    [init] Using Kubernetes version: v1.8.4
    [init] Using Authorization modes: [Node RBAC]
    [preflight] Running pre-flight checks
    [preflight] WARNING: docker version is greater than the most recently validated version. Docker version: 17.11.0-ce. Max validated version: 17.03
    [preflight] Starting the kubelet service
    [kubeadm] WARNING: starting in 1.8, tokens expire after 24 hours by default (if you require a non-expiring token use --token-ttl 0)
    [certificates] Generated ca certificate and key.
    [certificates] Generated apiserver certificate and key.
    [certificates] apiserver serving cert is signed for DNS names [master kubernetes kubernetes.default kubernetes.default.svc kubernetes.default.svc.cluster.local] and IPs [10.96.0.1 172.19.0.14]
    [certificates] Generated apiserver-kubelet-client certificate and key.
    [certificates] Generated sa key and public key.
    [certificates] Generated front-proxy-ca certificate and key.
    [certificates] Generated front-proxy-client certificate and key.
    [certificates] Valid certificates and keys now exist in "/etc/kubernetes/pki"
    [kubeconfig] Wrote KubeConfig file to disk: "admin.conf"
    [kubeconfig] Wrote KubeConfig file to disk: "kubelet.conf"
    [kubeconfig] Wrote KubeConfig file to disk: "controller-manager.conf"
    [kubeconfig] Wrote KubeConfig file to disk: "scheduler.conf"
    [controlplane] Wrote Static Pod manifest for component kube-apiserver to "/etc/kubernetes/manifests/kube-apiserver.yaml"
    [controlplane] Wrote Static Pod manifest for component kube-controller-manager to "/etc/kubernetes/manifests/kube-controller-manager.yaml"
    [controlplane] Wrote Static Pod manifest for component kube-scheduler to "/etc/kubernetes/manifests/kube-scheduler.yaml"
    [etcd] Wrote Static Pod manifest for a local etcd instance to "/etc/kubernetes/manifests/etcd.yaml"
    [init] Waiting for the kubelet to boot up the control plane as Static Pods from directory "/etc/kubernetes/manifests"
    [init] This often takes around a minute; or longer if the control plane images have to be pulled.
    [apiclient] All control plane components are healthy after 30.001692 seconds
    [uploadconfig] Storing the configuration used in ConfigMap "kubeadm-config" in the "kube-system" Namespace
    [markmaster] Will mark node master as master by adding a label and a taint
    [markmaster] Master master tainted and labelled with key/value: node-role.kubernetes.io/master=""
    [bootstraptoken] Using token: 5b0855.b90b56759e07723e
    [bootstraptoken] Configured RBAC rules to allow Node Bootstrap tokens to post CSRs in order for nodes to get long term certificate credentials
    [bootstraptoken] Configured RBAC rules to allow the csrapprover controller automatically approve CSRs from a Node Bootstrap Token
    [bootstraptoken] Configured RBAC rules to allow certificate rotation for all node client certificates in the cluster
    [bootstraptoken] Creating the "cluster-info" ConfigMap in the "kube-public" namespace
    [addons] Applied essential addon: kube-dns
    [addons] Applied essential addon: kube-proxy

    Your Kubernetes master has initialized successfully!

    To start using your cluster, you need to run (as a regular user):

      mkdir -p $HOME/.kube
      sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
      sudo chown $(id -u):$(id -g) $HOME/.kube/config

    You should now deploy a pod network to the cluster.
    Run "kubectl apply -f [podnetwork].yaml" with one of the options listed at:
      http://kubernetes.io/docs/admin/addons/

    You can now join any number of machines by running the following on each node
    as root:
      # 这个跟后续新增节点有关，务必记住
      kubeadm join --token 5b0855.b90b56759e07723e 172.19.0.14:6443 --discovery-token-ca-cert-hash sha256:2cad4211f45f0d454f9a3ac7f59e997248c57497421a0df719a08fca9e385cc1

  安装pod网络插件

    [root@master ~]# kubectl apply -f https://raw.githubusercontent.com/coreos/flannel/v0.9.1/Documentation/kube-flannel.yml

  如果节点有多个网卡的话，需要指定网卡名称，详情见这里：[https://github.com/kubernetes/kubernetes/issues/39701](https://github.com/kubernetes/kubernetes/issues/39701)

  不同网络插件略有不同，其它网络插件配置详情见这里：  
  [https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/#pod-network](https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/#pod-network)

  按照初始化集群后的提示，进行如下操作

    mkdir -p $HOME/.kube
    sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
    sudo chown $(id -u):$(id -g) $HOME/.kube/config

  查看集群状态

    [root@master ~]# kubectl get cs
    NAME                 STATUS    MESSAGE              ERROR
    scheduler            Healthy   ok
    controller-manager   Healthy   ok
    etcd-0               Healthy   {"health": "true"}

  kubeadm安装出来的k8s服务都是以容器形式运行，查看所有pod状态

    [root@master ~]# kubectl get pod --all-namespaces -o wide
    NAMESPACE     NAME                             READY     STATUS    RESTARTS   AGE       IP            NODE
    kube-system   etcd-master                      1/1       Running   0          20h       172.19.0.14   master
    kube-system   kube-apiserver-master            1/1       Running   0          20h       172.19.0.14   master
    kube-system   kube-controller-manager-master   1/1       Running   0          20h       172.19.0.14   master
    kube-system   kube-dns-545bc4bfd4-nt7k6        3/3       Running   0          20h       10.244.0.2    master
    kube-system   kube-flannel-ds-p9n2n            1/1       Running   0          20h       172.19.0.14   master
    kube-system   kube-proxy-5j8h7                 1/1       Running   0          20h       172.19.0.14   master
    kube-system   kube-scheduler-master            1/1       Running   0          20h       172.19.0.14   master

  让master节点也参与调度

    [root@master ~]# kubectl taint nodes master node-role.kubernetes.io/master-
    node "master" untainted

### 集群重置

    kubeadm reset
    ifconfig cni0 down
    ip link delete cni0
    ifconfig flannel.1 down
    ip link delete flannel.1
    rm -rf /var/lib/cni/


### 参考链接

- [使用kubeadm安装Kubernetes 1.8](https://blog.frognew.com/2017/09/kubeadm-install-kubernetes-1.8.html)
- [https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/](https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/)
