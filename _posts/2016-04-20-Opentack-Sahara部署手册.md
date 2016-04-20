---
layout: post
title: Opentack-Sahara部署手册
subtitle: 手动安装手册，不使用devstack
catalog: true
tag:
    - sahara
    - hadoop
    - openstack
    - 云计算
---

**注意：在RHEL 5 版本中，Openstack Sahara标记为`Technology Preview`，即只能用于实验，提供的功能并不完全，不能用于生产环境。**

## 1.Openstack sahara服务简介

Openstack Sahara旨在使用户能在Openstack平台上快速部署和管理Hadoop集群。Hadoop用于存储和分析海量非结构化数据，但也能同时处理复杂格式和结构化数据。Hadoop集群包括一组服务器，这些服务器既是存储服务器（运行HDFS），也是计算服务器（运行Hadoop MapReduce计算框架）。这些服务器不需要共享内存和磁盘，通常只需要共享网络，因此，集群节点很容易实现增加或者删除节点。

在Openstack Sahara中：

* 认证服务（Keystone）提供用户认证功能和提供用户安全机制
* 计算服务（Nova）为集群提供虚拟机
* 镜像服务（Glance）存储虚拟机镜像，这些镜像包括预装的Hadoop或者安装工具
* 对象存储服务（Swift）为Hadoop任务存储处理后的数据
* 模板服务（Heat）用于集群配置，其中节点模板用于定义组件编排，集群模板用于定义如何组合这些节点（定义集群拓扑）
* Jobs用于在Hadoop集群上执行任务，Job二进制包存储可执行代码，数据源（data sources）用于存储输入、输出位置以及访问证书

Sahara同时支持多个Hadoop发行版以及厂商的管理工具（比如Apache Ambari），既能使用Sahara CLI部署和管理集群，也能通过Dashborad完成相同的工作。

Sahara的服务组件如下：

|组件|描述|
|----|---|
|openstack-sahara-api|API服务，处理集群请求以及分发数据|
|sahara|Sahara CLI客户端,用户管理Sahara的命令行工具|
|sahara-db-manage|数据库管理的CLI客户端|
|sahara-dashboard|OpenStack dashboard的插件，用于在dashborad显示sahara页面|

## 2. 安装Openstack Sahara软件包

在控制节点安装以下包：

```bash
yum install openstack-sahara
```

这个包已经包括了sahara、sahara-db-manage以及sahara-api。**注意：集群创建和管理通常需要安装sahara-dashborad插件，这个插件必须安装在和dashborad同一台主机上，将在后续介绍如何安装和部署。**

## 3. 配置Sahara服务

配置Sahara服务，需要完成以下工作：

* 配置数据库
* 配置认证服务
* 配置防火墙（开放8386端口）

接下来的小节详细介绍以上配置。

### (1) 配置数据库

数据库连接URL定义在`/etc/sahara/sahara.conf`文件中，使用`openstack-config`命令配置：

```bash
openstack-config --set /etc/sahara/sahara.conf \
    database connection DB_TYPE://USER:PASS@IP:PORT/sahara
```

如果已经存在sahara服务的数据库，以下步骤省略，否则需要初始化sahara服务数据库表，执行以下命令：

```bash
sahara-db-manage --config-file /etc/sahara/sahara.conf upgrade head
```
以上命令还会自动配置`/etc/sahara/sahara.conf`连接URL。

### (2) 创建sahara服务记录

创建`sahara`用户：

```bash
keystone user-create --name sahara --pass PASSWORD
```
把`sahara`用户加到`services`租户并赋予`admin`角色：

```bash
keystone user-role-add --user sahara --role admin --tenant services
```

创建`sahara service`:

```bash
keystone service-create --name=sahara --type=data_processing --description="Sahara data processing"
```

创建sahara endpoint入口：

```bash
keystone endpoint-create \
    --service sahara \
    --publicurl "http://IP:8386/v1.1/%(tenant_id)s" \
    --adminurl "http://IP:8386/v1.1/%(tenant_id)s" \
    --internalurl "http://IP:8386/v1.1/%(tenant_id)s"
```

其中`IP`为部署主机的IP地址或者域名。

创建完以上信息后，接下来还需要配置sahara-api与Keystone服务认证。首先需要配置认证服务的主机和端口：

```bash
openstack-config --set /etc/sahara/sahara.conf \
   DEFAULT os_auth_host IP
openstack-config --set /etc/sahara/sahara.conf \
   DEFAULT os_auth_port PORT
```
其中`IP`为认证服务器的IP地址或者域名，`PORT`为认证端口。

配置Sahara API认证的用户名、密码以及租户：

```bash
openstack-config --set /etc/sahara/sahara.conf \
   DEFAULT os_admin_username sahara
openstack-config --set /etc/sahara/sahara.conf \
   DEFAULT os_admin_password SERVICE_PASSWORD
openstack-config --set /etc/sahara/sahara.conf \
   DEFAULT os_admin_tenant_name services
```
其中`SERVICE_PASSWORD`为上面我们创建`sahra`用户时设置的密码。

### (3) 防火墙配置

Sahara需要使用端口8386，因此RHEL需要开放此端口。对于RHEL 6版本操作系统，修改`/etc/sysconfig/iptables`,增加`INPUT`规则允许`TCP/8836`通过，新规则必须出现在所有`REJECT`的`INPUT`规则之前.

```bash
-A INPUT -p tcp -m multiport --dports 8386 -j ACCEPT
```

配置完成后需要重启`iptables`服务:

```bash
service iptables restart
```

对于RHEL 7版本操作系统，执行以下命令即可：

```bash
firewall-cmd --permanent --add-port=8386/tcp
firewall-cmd --add-port=8386/tcp
```

### (4) 其他配置

sahara的配置文件为`/etc/sahara/sahara.conf`,用户安装时，默认会提供两个样例配置文件，这两个文件可用于参考：

* `/etc/sahara/sahara.conf.sample-basic`:列举了所有必需的参数。
* `/etc/sahara/sahara.conf.sample`:列举了所有可用的参数和选项。

在启动sahara服务以前，需要配置Openstack使用的网络服务，如果使用neutron，配置如下：

```bash
openstack-config --set /etc/sahara/sahara.conf \
    DEFAULT use_neutron true
```

## 4.启动Sahara服务

启动服务只需要在安装的主机上运行以下命令：

```bash
systemctl start openstack-sahara-api.service
```

## 5.安装和配置Dashboard插件

创建和管理集群最好使用Sahara用户界面，安装用户界面只需要安装Sahara dashborad插件，**插件必须安装在dashborad所在的主机上**，而不是和Sahara部署在同一台主机。

在运行dashborad的主机上运行以下命令开始安装sahara插件：

```bash
yum install python-django-sahara
```

打开dashborad的python配置文件(即`/usr/share/openstack-dashboard/openstack_dashboard/settings.py`),增加`sahara`到`HORIZON_CONFIG`列表中，比如：

```python
HORIZON_CONFIG = {
     'dashboards': ('nova','syspanel','settings',...,'sahara')
```

增加`saharadashboard`到`INSTALLED_APPS`元组中，比如：

```python
INSTALLED_APPS = (
     'saharadashboard',
     ...
)
```
接下来打开`/etc/openstack_dashboard/local_settings.py`文件，指定网络服务组件以及配置Sahara API地址：

```python
SAHARA_USE_NEUTRON = True
SAHARA_URL = 'SAHARA_IP:PORT/v1.1'
```

**注意：**：如果部署Openstack时使用的是nova-network并且设置`auto_assign_floating_ip=False`,需要增加以下配置到`/etc/openstack_dashboard/local_settings.py`文件中：

```bash
AUTO_ASSIGNMENT_ENABLED = False
```

最后重启`httpd`服务:

```bash
service httpd restart
```

## 总结

Openstack Sahara建立在Nova、Glance、Heat、Swift等服务之上，旨在为用户提供快速部署和管理Hadoop集群功能，实现类似AWS EMR(Elastic MapReduce Service)功能，但截至到Openstack Mitaka版本仍处于实验阶段，还不能用于实际生产中。若需要快速搭建测试环境，可使用devstack部署。

## 参考

* [Openstack RHEL安装文档](https://access.redhat.com/documentation/en-US/Red_Hat_Enterprise_Linux_OpenStack_Platform/5/html/Installation_and_Configuration_Guide/chap-OpenStack_Sahara_Installation.html)
