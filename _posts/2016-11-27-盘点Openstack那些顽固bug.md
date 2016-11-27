---
layout: post
title: 盘点Openstack那些顽固bug
catalog: true
tags:
     - Openstack
---

## 背景
Openstack从2010年7月A版本发布，截至现在（2016年11月27日）已经6岁半了。如今最新发布的版本为第14个版本，代号为Newton。Openstack从诞生到现在走过的6个年头，吸引了全世界的开发者参与，成为云计算领域开源项目中最火热的项目之一（其余项目分别为Spark、Docker、K8s等）。目前Openstack已经不仅仅包括基础的计算服务（Nova)、存储服务(Cinder、Swift）以及网络服务（Neutron），还包括诸如数据库服务（Trove）、大数据服务（Sahara）、容器编排服务（Magnum）等几乎覆盖了整个云生态栈。但是，Openstack的发展过程中，还跟随着一些大大小小的bugs，大多数bug一旦被report并confirm，很快就会被fix。但是也有少数bug非常顽固，有些已经存活了好几年仍然没有修复。

![bug](/img/posts/盘点Openstack那些顽固bug/bug.jpeg)

本文将盘点Openstack中那些顽固bug，这些bug至少存活了一年。

## 1. 设置quota时没有检查租户是否存在

* bug地址:[Nova should confirm quota requests against Keystone](https://bugs.launchpad.net/nova/+bug/1118066)。
* report时间: 2013-02-07
* 存活寿命: 3岁半

当设置quota时需要指定租户project/tenant，但是目前nova和cinder都不会对租户是否存在进行检查，当该租户的quota记录不存在时就创建一个新的quota记录。比如：

```
cinder quota-update --volumes 10 any-string
```

以上无论你输入任何字符串，都会返回200 OK，即使租户并不存在。

由于租户配额管理只有admin角色有权限，因此必须假定:

>And as an admin (trusted user), we expect them to not break things.

即管理员是可信任的，假定你不会把事情搞砸。

当然作为管理员恶意攻击不太可能，不过很多管理员都可能会把租户输成租户名，而注意**该API只支持租户id**,你输入租户名不会报错，但不会生效。

该bug难以解决的原因是目前keystone尚无实现检查租户是否存在的接口。

针对该bug已经提交成一个独立的BP，[validate-project-with-keystone](https://blueprints.launchpad.net/nova/+spec/validate-project-with-keystone),并将在下个版本Ocata实现。

使用python-openstackclient会对租户进行检查，设置quota时可以考虑使用该client取代。

## 2. 使用统一分布式存储时计算磁盘空间错误

* bug地址: [nova hypervisor-stats shows wrong disk usage with shared storage](https://bugs.launchpad.net/nova/+bug/1414432)
* report时间: 2015-01-25
* 存活寿命: 1岁半

`nova hypervisor-stats`命令用于获取整个Openstack集群可用的物理资源总量，统计包括cpu、内存和磁盘三种资源，实现方法是由各个计算节点的`resource_tracker`统计该节点的资源量，并定期更新到数据库中。nova调用`hypervisor-stats`时即对所有计算节点的资源求总和。对于cpu以及内存完全没有问题，但如果使用分布式共享存储作为后端存储时，计算磁盘空间就是错误的，因为每个计算节点看到的资源都是分布式存储的总资源量大小。比如使用ceph做后端存储，每个计算节点看到的都是`ceph df`看到可用空间的大小，在计算资源总和时不应该再相加，否则就相当于多算了N倍。因此如果有N个计算节点，相当于对资源计算多算了N倍。

## 3. 软删除存在DOS漏洞。

* bug地址: [Enabling soft-deletes opens a DOS on compute hosts](https://bugs.launchpad.net/nova/+bug/1501808)
* report时间: 2015-10-01

该bug是一个安全漏洞，不过已于今年1月公开。

Openstack支持虚拟机软删除功能，用户可以设置虚拟机的保留时间。当用户删除虚拟机时，不会真的立即删除虚拟机，而仅仅是做一个删除标记，保留时长为设置的保留时间，当超过保留时间时，系统才真正清理虚拟机。该功能能够使用户不慎删除虚拟机能立即撤回操作，避免数据丢失。

换句话说，虚拟机软删除时，虚拟机的资源并没有释放，并且不占用户配额。恶意用户可以不断创建虚拟机不断删除虚拟机，直到耗尽所有的物理资源。

Michael Still说:

>This is definitely be design. That said I agree there is a DoS possible here.

>It seems to me there is a tweak we could make where if a hypervisor becomes space constrained we delete earlier than the configured time, but that might be a surprise for administrators using a "fill first" scheduling methodology.
>

因此这个bug至今尚未修复。

## 4.console.log文件可能占据整个磁盘空间

* bug地址: [console.log grows indefinitely](https://bugs.launchpad.net/nova/+bug/832507)
* report时间: 2011-08-24
* 存活寿命: 5岁

console log保存虚拟机启动时的日志，用户可以使用`nova console-log`命令查看，KVM会把所有的标准输出打印到console.log中，并且没有大小限制，如果用户无休止地发送数据到stdout中，console.log文件将可能占据整个磁盘空间。

该bug在不断修复过程中，至今没有彻底修复。

## 5. Nova和cinder数据卷挂载状态不一致

bug地址: [Nova and Cinder get desynced on volume attachments](https://bugs.launchpad.net/nova/+bug/1499012)
report时间： 2015-09-23

该bug很早就已经存在，只是到2015年才有人report。
通常卸载volume卷包括如下三个步骤:

* 1 调用libvirt卸载磁盘设备
* 2 通知cinder
* 3 删除BDM(block device mapping)记录

如果第一步失败，此时虚拟机处于error状态，但volume挂载状况和cinder仍然是同步的，只需要执行reset-state回滚即可。

如果第二步失败，此时nova认为volume已经卸载了，但cinder没有接收到通知，仍然认为volume是被挂载的。此时nova不能再执行detach操作，因为volume已经不存在了。但cinder也不能再执行挂载操作，因为volume还处于in-use状态。修复办法是使用cinder reset-stat或者只能修改数据库了。

社区曾经提过spec清理volume挂载，但至今尚未实现，讨论地址：
[
Nova-manage command for cleaning volume attachment](https://review.openstack.org/#/c/184537/).

继续补充中...

