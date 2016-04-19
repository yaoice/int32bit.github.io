---
layout: post
title: 使用Sahara快速部署Hadoop集群
subtitle: Sahara本质就是一个组件编排服务、模板服务
catalog: true
tags:
     - sahara
     - hadoop
     - openstack
     - 云计算
---
# 使用sahara快速部署Hadoop集群

## 0. 前置条件

本文将详细介绍如何使用sahara快速部署hadoop集群，注意由于sahara相对其他服务复杂，使用命令行时需要传递的参数过多，故本文主要介绍通过dashboard的方法部署。在此之前请先确定已经部署好sahara环境，如果还没有这个环境，可以参考[使用devstack快速部署sahara测试环境](http://int32bit.github.io/2016/04/10/使用devstack快速部署sahara测试环境/)一个测试环境。另外本文使用的是openstack最新版本Mitaka，测试vanilla的hadoop2.7.1版本，base image使用的ubuntu，需要往`http://sahara-files.mirantis.com/images/upstream/mitaka/`下载`sahara-mitaka-vanilla-hadoop-2.7.1-ubuntu.qcow2`文件，该文件较大，建议使用`axel`下载。

## 1. 注册镜像

首先需要上传下载的镜像到glance中，使用如下命令完成上传：

```bash
glance image-create --name sahara-mitaka-vanilla-hadoop-2.7.1-ubuntu-14.04 --file sahara-mitaka-vanilla-hadoop-2.7.1-ubuntu.qcow2 --disk-format qcow2 --container-format bare --visibility public --progress
```

完成上传后，需要往sahara dashboard界面注册镜像（也可以通过命令行操作，打入版本和用户名标签，为了简便，我们使用dashboard操作），选择页面-project-Dataprocessing-Clusters-Image Registry,单击Register Image按钮，如图:
![1](/img/posts/使用Sahara快速部署Hadoop集群/1.png)
进入注册页面，如图：
![2](/img/posts/使用Sahara快速部署Hadoop集群/2.png)
选择我们刚刚上传的镜像，用户名务必填写正确，**注意不是你当前登录的用户名，而是镜像的初始用户名**，不同的镜像不同的用户名，具体参考[官方文档说明](http://docs.openstack.org/developer/sahara/userdoc/plugins.html)，然后**务必选择Plugin和版本，并点击Add plugin tags**，此时上面会显示增加的标签。完成后点击Done按钮完成镜像注册，注册成功后结果如图：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/3.png)
此时完成了镜像的注册，后续我们将使用该镜像进行快速部署Hadoop集群。

## 2. 创建节点模板

节点模板定义该节点需要部署什么组件，比如`DataNode`、`NameNode`、`ResourceManager`等，类似[Cloudeara-manager](http://www.cloudera.com/documentation/archive/manager/4-x/4-8-6/Cloudera-Manager-Installation-Guide/cmig_install_path_A.html#cmig_topic_6_5_3_unique_1)的角色配置。由于我们只是做测试，不考虑复杂的集群拓扑，不考虑高可用，只定义两种类型模板，一是Master节点，服务组件为namenode、secondarynamenode、resoucemanager，另一个为Slave节点，配置nodemanager、datanode组件。点击Node Group Templates-Create Template增加节点模板，选择插件名称和版本，如图：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/4.png)
Openstack Flavor选择节点的资源配置，Base Image选择镜像，**注意和之前注册以及之前填写的参数必须保持一致**，节点需要较大的磁盘存储，建议使用Cinder卷，Floating IP必须设置，且保证可通，后面部署会一直循环测试IP的连通性，若连接不通，部署将失败。点击Node Processes，进行组件选择，如图：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/5.png)
我们选择了`namenode`、`secondarynamenode`以及`resourcemanager`，除了组件选择，还能对组件进行参数配置，比如`ResourceManager Heap Size`等，如图：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/6.png)
配置完成后点击，Create按钮完成Master节点的配置，重复以上步骤创建Slave节点模板配置，完成后如图：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/7.png)
自此我们完成了节点的模板，实际部署时，我们可能需要定义更多的模板，组件可定制性非常强。

## 3. 创建集群模板

集群模板就是定义集群拓扑以及大小，比如需要多少个Slave节点、多少个Master节点，这些节点如何连通等，其实就是我们之前定义的节点模板的合法组合。点击Cluster Templates-Create Template进行集群模板创建，选择插件类型和版本后进入创建窗口，如图：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/8.png)
Node Groups选择节点数量，我们使用一个Master节点和3个Slave节点，如图
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/9.png)
其他的是Hadoop集群的参数配置，根据实际需求配置即可，需要注意的是**`dfs.replication`必须小于等于`datanode`大小**，否则会在后面验证集群中失败。配置完成后，点击Create完成创建，如图：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/10.png)
点击Actions的Launch Cluster开始部署集群。

## 4. 部署集群

由于后期可能需要ssh到虚拟机中，因此需要预先创建自己的密钥，在集群模板列表中，选择其中一个集群，点击Launch Cluster开始部署集群，选择镜像（必须和之前的一致）、密钥，如图：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/11.png)
点击Launch开始启动部署，sahara需要对集群进行验证（比如是否配置正确、组件是否完整合法、资源是否充足、网络是否连通等），然后会与Nova组件交互，创建所有定义节点的虚拟机并分配IP，然后进行组件的自动安装和配置、组件启动等一系列流程，可以在Clusters页面查看进度，如图：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/12.png)
点击名称，进入集群详细信息，可以点击Cluster Events查看更具体的进度，如图：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/13.png)
通常需要几十分钟的时间才能部署完成，具体取决于集群的大小、机器配置等，一共有11个子流程，如图：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/14.png)
完成后进入集群：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/15.png)

## 5. 集群扩容

建立的集群可以调整大小，点击Scale Cluster，如图：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/16.png)
用户可以自由重置Slave节点的数量、以及Master节点的数量（不为1校验不通过，因为会有多个namenode）。

## 6. 集群监控

集群监控相对Cloudera-Manager还是差距挺大的，在集群详细信息的Cluster health checks进行检查，输出报告如下：
![图片打开失败](/img/posts/使用Sahara快速部署Hadoop集群/17.png)

## 7.总结

本文利用Sahara快速部署了一个4节点的Hadoop集群，我们发现，**Sahara本质就是一个组件编排服务**，它建立在`Heat`、`Glance`、`Nova`组件之上，通过进一步封装，为用户提供集群模板，模板包括了节点配置、组件配置、集群大小和拓扑等，Sahara根据用户定义的模板通过创建对应的虚拟机完成Hadoop集群的创建。由于虚拟机可以随时创建和销毁，因此利用Sahara创建集群天生支持扩容，这相对于物理机具有优势，能够提供弹性数据分析计算服务。但是集群监控相对于成熟的Cloudera产品，仍然还有较大的差距，高可用尚未有成熟的验证，仍然处于不成熟阶段，期待它的进一步成长！
