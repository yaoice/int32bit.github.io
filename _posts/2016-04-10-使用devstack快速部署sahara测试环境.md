---
layout: post
title: 使用devstack快速部署sahara测试环境
subtitle: 一步步实践，无坑分享
catalog: true
tag:
    - sahara
    - openstack
    - 云计算
    - hadoop
---

## 1.申请公有云主机和云硬盘

访问[UOS](https://www.ustack.com/)申请云主机，选择操作系统为`ubuntu14.04 64位`！
**注意：由于后续我们要部署hadoop集群，至少需要两个节点，且配置为`m1.small`，因此我们申请的云主机必须满足要求，即`vcpu > 4, memory > 4GB`**,否则后面部署集群时会出现`no valid host`错误而失败！我在部署时使用的配置为`16 vcpu，32GB memory`。
由于我们的公有云主机默认只有20GB磁盘空间，整个盘挂载到了根下，且没有使用LVM，无法扩容磁盘空间，我们后续部署hadoop集群时需要较大的磁盘空间，一个节点至少需要20GB，显然满足不了要求，我们可以通过挂载云硬盘方式解决这个问题。在我们的公有云上申请一块200GB（大于50GB）的云硬盘并挂载到云主机中，挂载后先不用管它，后续我们再处理。

## 2.安装devstack

### 修改`apt`源

ssh登录虚拟机，修改`apt`源，我们使用了[阿里云镜像](http://mirrors.aliyun.com/)，这样可以获得更快的下载速度:

```
fgp@devstack:~$ cat /etc/apt/sources.list
deb http://mirrors.aliyun.com/ubuntu/ trusty main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ trusty-security main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ trusty-updates main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ trusty-proposed main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ trusty-backports main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ trusty main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ trusty-security main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ trusty-updates main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ trusty-proposed main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ trusty-backports main restricted universe multiverse
```

### 安装基本工具

```bash
sudo apt-get update -y
sudo apt-get install -y git python-pip
```

安装pip后，为了提高下载速度，建议使用国内的镜像源：

```bash
mkdir -p ~/.pip
cat >~/.pip/pip.conf <<EOF
[global]
index-url = https://pypi.mirrors.ustc.edu.cn/simple
EOF
```

### 拉取源码并创建stack用户

```bash
git clone https://github.com/openstack-dev/devstack.git
cd devstack/
```
devstack需要`sudo`免密码登录，自带脚本快速创建stack用户：

```bash
./tools/create-stack-user.sh
su stack
cd ~
sudo mv /root/devstack/ .
sudo chown -R stack:stack ./devstack
```

### 选择安装版本

从github下拉取的devstack包含了多个openstack版本，通过不同的分支区分，使用git命令查看：

```bash
git branch -a
```

以`**/stable/xxx`命名的就是提供的版本，使用前切换不同的分支就可以选择安装不同的版本，比如如果想安装`Liberty`的OpenStack：

```bash
git checkout stable/liberty
```

### 配置

```bash
cd ./devstack
cp samples/local.conf .
```

为了加快安装速度，可以添加国内的trystack git源，修改`local.conf`:

```conf
[[local|localrc]]
 
# use TryStack git mirror
GIT_BASE=http://git.trystack.cn
NOVNC_REPO=http://git.trystack.cn/kanaka/noVNC.git
SPICE_REPO=http://git.trystack.cn/git/spice/spice-html5.git
```

以上即完成devstack的基本配置，如果不需要安装其他插件，直接运行`./stack.sh`即可快速部署具有`keystone`、`glance`、`nova`以及`dashboard`的openstack环境。

### 启用sahara插件

除了openstack的基本服务，比如`keystone`,`glance`,`nova`等，其他服务均以插件的形式安装，安装插件只需要简单的追加如下配置:

```
enable_plugin PLUGIN_NAME PLUGIN_ADDRESS
```

比如安装sahara组件，追加以下内容到`local.conf`:

```
enable_plugin sahara https://github.com/openstack/sahara.git
enable_plugin sahara-dashboard https://github.com/openstack/sahara-dashboard.git
```

**注意：**

* 务必安装sahara-dashboard，否则sahara只能使用命令行工具，而文档手册几乎全部基于dashboard的操作，使用命令行操作非常麻烦。
* 插件地址不要使用git.openstack.org，访问非常不稳定，经常失败。

如果需要安装其他插件，比如trove、magnum，只需要替换以上的`sahara`分别为`trove`、`magnum`即可。


另外附上所有[devstack可用插件列表](http://docs.openstack.org/developer/devstack/plugin-registry.html)。

### 开始安装

```bash
./stack.sh
```

安装过程中容易出现更新源失败导致后续流程失败，此时更新镜像源可能解决问题，我在测试是刚开始使用的163镜像源，发现老失败，换成了[阿里云镜像](http://mirrors.aliyun.com/)。

### 校验是否安装成功

若安装成功，会输出dashborad地址以及默认的用户名和密码，登录dashboard，看sahara服务是否安装好，即在项目中是否有“数据处理”菜单，并在命令行运行`sahara cluster-list`看是否正常:

```bash
source  openrc admin admin
sahara cluster-list
# or
# openstack cluster list
```

## 3.挂载云硬盘到分区

在步骤1中我们申请了云硬盘并挂载到了我们的云主机（对应虚拟设备为`/dev/vdb`)，并提出了由于磁盘空间大小限制导致满足不了hadoop集群部署条件。注意和常规部署不一样，使用devstack部署openstack时nova的data不是保存在`/var/lib/nova`下，而是保存在`/opt/stack/data/nova`目录下，因此扩容`/var`分区并不能凑效，而必须扩容`/opt/stack/data/nova`目录。由于虚拟机实例文件主要保存在`instances`子目录下，因此我们只需要扩容子目录`instances`即可:

```bash
sudo mkfs.ext4 /dev/vdb # 初始化分区，创建文件系统
cd /opt/stack/data/nova
sudo mv instances instances_bak # 备份instances目录
sudo mkdir instances # 创建新的instances目录，作为挂载点
sudo mount /dev/vdb /opt/stack/data/ # 挂载云硬盘到data中
sudo mv instances_bak/* instances/ # 恢复备份的文件
sudo chown -R stack:stack instances 
```

完成后运行`df`命令查看是否正确配置。

```bash
df -Th
```
输出如下：

```
Filesystem     Type      Size  Used Avail Use% Mounted on
udev           devtmpfs   16G   12K   16G   1% /dev
tmpfs          tmpfs     3.2G  928K  3.2G   1% /run
/dev/vda1      ext4       19G  7.2G   11G  41% /
none           tmpfs     4.0K     0  4.0K   0% /sys/fs/cgroup
none           tmpfs     5.0M     0  5.0M   0% /run/lock
none           tmpfs      16G     0   16G   0% /run/shm
none           tmpfs     100M     0  100M   0% /run/user
/dev/vdb       ext4      251G  7.5G  231G   4% /opt/stack/data
```

## 4.安装hadoop集群

Hadoop有很多发行版，比如cdh、hortonworks、vanilla等，sahara针对不同的版本通过不同的插件实现，使用devstack部署sahara默认支持几乎所有主流的发行版，下面以安装vanilla为例部署。
首先下载[Mirantis提供的镜像](http://sahara-files.mirantis.com/images/upstream/),提供针对各种不同版本openstack的不同Hadoop发行版现成镜像下载，不用自己折腾制作了。

```bash
axel -n 20 http://sahara-files.mirantis.com/images/upstream/mitaka/sahara-mitaka-vanilla-hadoop-2.7.1-ubuntu.qcow2 
```
为什么不用`wget`？要的是速度！！！下载速度达到`2MB/s`!

下载完毕后上传到glance镜像仓库中：

```bash
glance image-create --name sahara-mitaka-vanilla-hadoop-2.7.1-ubuntu-14.04 --file sahara-mitaka-vanilla-hadoop-2.7.1-ubuntu.qcow2 --disk-format qcow2 --container-format bare –visibility public --progress
```
**注意设置镜像为`public`，否则其他租户不可见。**

接下来需要注册镜像到`sahara`中，在`dashboard`中打开“数据处理->注册镜像”，选择上传的镜像，用户名根据不同的镜像不同，参考[官方文档](http://docs.openstack.org/developer/sahara/userdoc/plugins.html)，找到对应的插件，即可查看用户名。**注意：用户名必须填写正确，否则后面创建集群时在配置过程中会失败！**

镜像需要打上发行版以及版本标签，用于区分使用哪种插件，在下拉菜单中选择对应的选项即可。完成镜像注册后，配置节点组角色模板，每个节点组选择需要部署的服务，由于只用于测试，部署最简单的hadoop环境，设置了两个节点组模板，分别为`Master`和`Slave`。

其中Master分配的服务角色为：

* namenode
* secondarynamenode
* resourcemanager

Slave分配的服务角色为：

* datanode
* nodemanager

然后创建集群模板，选择`Master`和`Slave`节点各一个（单机资源有限啊），`dfs.replication`设置为1（因为我们只有一个`datanode`）。
上传自己的公钥后后点击启动集群，选择我们创建的模板以及密钥，完成创建。创建过程中会首先创建两个虚拟机实例，可以往计算服务面板查看。
点击创建的集群名称可以进入集群的详细信息，点击集群事件面板可以查看集群部署进度。
注意在`assign IP`进度时，**使用devstack若没有设置自动分配浮动ip，这个过程会一直堵塞直到手动绑定浮动ip，所以虚拟机创建成功后，务必绑定浮动ip**。等待大约20分钟集群部署完成。

## 5.遇到的坑

* devstack部署完后，如果修改了`local.conf`配置文件或者重启主机，需要`unstack`然后`stack`重新部署，每次部署需要花费大量时间，并且所有数据都会丢失。
* 目前版本没有rejoin-stack。
* 官方没有重启服务的脚本。
 
