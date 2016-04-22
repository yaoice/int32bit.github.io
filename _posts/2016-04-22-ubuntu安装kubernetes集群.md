---
layout: post
title: ubuntu安装kubernetes集群
subtitle: 记录第一次实践部署k8s集群
catalog: true
tags:
     - docker
     - k8s
     - ubuntu
---
# ubuntu安装kubernetes集群

## 一、安装环境

本文在使用ubuntu快速部署k8s集群，一共包括4各节点，其中任意一个作为master节点，所有节点都作为minion节点，即一共有4个minion节点。安装的操作系统为`ubuntu14.04`，各个节点的主机名和IP为：

```
192.168.0.2     master
192.168.0.5     node1
192.168.0.7     node2
192.168.0.6     node3
```

## 二、安装前工作

我们所有工作都在master节点操作，因此为了方便，我们使用ansible进行集群管理，因此安装前环境为：

* master节点安装了ansible工具
* master能够免密码登录所有节点
* 所有用户能够免密码sudo（否则部署时不断要输入密码）
* 所有的minion节点部署docker和bridge-utils

### 1.安装ansible

参考[使用ansible工具批量管理远程主机](http://int32bit.github.io/2016/04/20/使用ansible工具批量管理远程主机/)。其中本文使用的`hosts`文件为：

```
[master]
master
[nodes]
node1
node2
node3
```
以上虽然在部署时其实master也作为minion节点，但为了方便操作，没有把它放到`nodes`组中。

### 2master能够免密码登录所有节点

参考[使用ansible工具批量管理远程主机](http://int32bit.github.io/2016/04/20/使用ansible工具批量管理远程主机/)。

### 3.所有用户能够免密码sudo

首先使用`visudo`修改`/etc/sudoers`文件，注意不要直接修改文件，否则出现语法错误比较麻烦。假设用户名是int32bit，则增加以下条目：

```conf
int32bit ALL=(root) NOPASSWD:ALL
```

然后把这个文件拷贝到所有机器中，注意该文件只有root可读，因此需要先赋予我们读权限，然后才能拷贝：

```bash
sudo chmod +r /etc/sudoers # 增加读权限
ansible nodes  -m copy -K --sudo -a "src=/etc/sudoers dest=/etc/"
ansible all  -m shell -K --sudo -a "chmod 400 /etc/sudoers" # 恢复权限
```

### 4.安装docker和bridge-utils

```bash
ansible all -m shell -K --sudo -a 'curl -fsSL https://get.docker.com/ | sh' # Download docker and install it.
ansible all -m shell -K --sudo -a 'usermod -aG docker int32bit'
ansible all -m shell -o -a 'docker ps' # test docker
ansible all --sudo -K -m shell -a 'apt-get install -y --force-yes bridge-utils' # install bridge-utils
```

## 三、开始部署k8s

k8s安装比较简单，自带安装脚本，只需要简单的配置即可。
首先从github上拉取项目：

```bash
git clone https://github.com/kubernetes/kubernetes.git
```

修改配置文件`cluster/ubuntu/config-default.sh`:

```
export nodes="int32bit@192.168.0.2 int32bit@192.168.0.5 int32bit@192.168.0.7 int32bit@192.168.0.6 vcap@10.10.103.16"
export role="ai i i i"
export NUM_NODES=${NUM_NODES:-4}
export SERVICE_CLUSTER_IP_RANGE=192.168.3.0/24
export FLANNEL_NET=172.16.0.0/16
```
其中`nodes`填写所有节点的用户名和ip，master节点放在第一个。`role`分配角色，`i`表示minion节点，`a`表示master节点，由于我们第一个节点既是master又是minion，因此填写`ai`。`SERVICE_CLUSTER_IP_RANGE`配置内网IP。`FLANNEL_NET`是容器内部IP。

另外需要注意的是，k8s会往`gcr.io`拉取镜像，由于国内被墙的原因，不能连接导致后期启动服务时失败，建议修改配置文件`cluster/ubuntu/minion/init_conf/kubelet.conf`,最后一个脚本`exec "$KUBELET" $KUBELET_OPTS"`改为：

```bash
exec "$KUBELET" $KUBELET_OPTS --pod-infra-container-image="docker.io/kubernetes/pause"
```

配置完后，在`cluster/`目录下执行以下命令：

```bash
KUBERNETES_PROVIDER=ubuntu ./kube-up.sh
```
其中`KUBERNETES_PROVIDER=ubuntu`是指定OS发行版，`kube-up.sh`脚本会根据不同的发行版执行不同的脚本，为了方便，可以写到shell初始化脚本中`~/.bashrc`:

```bash
export KUBERNETES_PROVIDER=ubuntu
```

执行后，该脚本会先拷贝k8s以及其配置文件到所有的主机，并利用ssh执行对应角色的脚本，如果之前没有设置sudo免密码登录，每个节点都需要输入sudo密码。

通常几分钟就能执行完毕，并提示结果，如果有fail，可以查看`/var/log/upstart/kube*.log`，如果需要重新部署，首先执行`kube-down.sh`脚本，再重新执行`kube-up.sh`。

部署成功，把`cluster/ubuntu/binaries/kubectl`放到`PATH`变量中，执行`kubectl get nodes`命令查看节点状态，结果如下：

```
NAME          STATUS    AGE
192.168.0.2   Ready     19h
192.168.0.5   Ready     19h
192.168.0.6   Ready     19h
192.168.0.7   Ready     19h
```

可见4个mimin节点运行正常。

## 四、测试Hello World

k8s命令行工具是`kubectl`,使用`create`子命令创建应用(也可以使用`run`命令直接指定参数运行），输入文件是一个yaml的配置文件，类似`docker-compose.yml`，指定名称、镜像等，我们的`hello-world.yml`为：

```yml
apiVersion: v1
kind: Pod
metadata:
  name: hello-world
spec:  # specification of the pod's contents
  restartPolicy: Never
  containers:
  - name: hello
    image: "hello-world"
```

使用`kubectl create -f hello-world.yml`命令执行：

```
int32bit@master:~$ kubectl create -f hello.yaml
pod "hello-world" created
```
执行创建请求后，k8s会立即返回（居然不返回ID）。然后可以使用`kubectl get pods`查看运行状态：


```
int32bit@master:~$ kubectl get pods
NAME                         READY     STATUS              RESTARTS   AGE
hello-world                  0/1       ContainerCreating   0          21s
test-nginx-736395258-6tth7   1/1       Running             0          18h
test-nginx-736395258-jmznd   1/1       Running             0          18h
test-nginx-736395258-ps7i7   1/1       Running             0          18h

int32bit@master:~$ kubectl get pods --show-all
NAME                         READY     STATUS      RESTARTS   AGE
hello-world                  0/1       Completed   0          27s
test-nginx-736395258-6tth7   1/1       Running     0          18h
test-nginx-736395258-jmznd   1/1       Running     0          18h
test-nginx-736395258-ps7i7   1/1       Running     0          18h
```
可见刚开始处于`ContainerCreating`状态，此时可能需要拉取镜像，创建Docker容器实例等工作，最后运行后变成`Completed`状态，表示执行完毕。可以使用`kubectl logs`命令查看输出：

```
int32bit@master:~$ kubectl logs pods/hello-world

Hello from Docker.
...
```

查看运行主机：

```
int32bit@master:~$ kubectl get -f hello.yaml  -o yaml | grep -i 'hostIP'
  hostIP: 192.168.0.6
```
可见该实例在`192.168.0.6`这个主机上，验证下：

```bash
ansible all -i 192.168.0.6, -m shell -a 'docker ps -a -f ancestor=hello-world'
```
输出：

```
192.168.0.6 | success | rc=0 >>
CONTAINER ID        IMAGE               COMMAND             CREATED             STATUS                      PORTS               NAMES
b8e2f9c2ce24        hello-world         "/hello"            13 minutes ago      Exited (0) 13 minutes ago                       k8s_hello.c9b909ed_hello-world_default_718b6af8-0830-11e6-a8db-fa163e34d2fb_35ec43d7
```
可见hello-world容器在主机中启动。

删除该实例使用:

```bash
kubectl delete pods/hello-world
```
或者

```
kubectl delete -f hello.yaml
```

## 总结

Kubernetes作为Docker生态圈中重要一员，从Borg脱胎而生，是google多年大规模容器管理技术的开源版本，随着Kubernetes社区及各大厂商的不断改进、发展，Kuberentes将成为容器管理领域的领导者，提供应用部署、维护、 扩展机制等功能，利用Kubernetes能方便地管理跨机器运行容器化的应用。文本只是简单的介绍了它的部署方法以及通过`hello-world`验证，后续将继续学习k8s并分享。


