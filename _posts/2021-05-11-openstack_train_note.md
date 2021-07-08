---
layout: post
title: OpenStack Train实践（纯操作）
subtitle: ""
catalog: true
tags:
     - OpenStack
---

## 1. 环境

- 系统：CentOS 7.8
- kernel: 3.10.0-1127.el7.x86_64
- OpenStack: Train版

- Controller Node（172.16.88.245）: 48 processor, 376 GB memory
- Compute Node（172.16.88.246）: 48 processor, 376 GB memory

## 2. OpenStack

### 2.1 OpenStack架构

概念架构：
<img src="https://docs.openstack.org/install-guide/_images/openstack_kilo_conceptual_arch.png"/>

逻辑架构：
<img src="https://docs.openstack.org/install-guide/_images/openstack-arch-kilo-logical-v1.png">

### 2.2 Controller Node

#### 2.2.1 静态域名解析

```
# vim /etc/hosts
127.0.0.1   localhost localhost.localdomain localhost4 localhost4.localdomain4
::1         localhost localhost.localdomain localhost6 localhost6.localdomain6

172.16.88.245 controller1
172.16.88.246 computer1
```

#### 2.2.2 NTP

安装chrony
```
# yum install -y chrony
```

编辑chrony配置
```
# vim /etc/chrony.conf
# Allow NTP client access from local network.
allow 172.16.0.0/16
```

启动chrony
```
# systemctl enable chronyd.service
# systemctl restart chronyd.service
```

查看NTP同步情况
```
# chronyc sources
210 Number of sources = 4
MS Name/IP address         Stratum Poll Reach LastRx Last sample
===============================================================================
^- undefined.hostname.local>     2   7   377    66  +3915us[+3601us] +/-  108ms
^- ntp6.flashdance.cx            2   6   376   324   +835us[ +754us] +/-  155ms
^- ntp.xtom.nl                   2   7    17   121  -3981us[-4273us] +/-   96ms
^* 119.28.206.193                2   7   373     2   -715us[-1030us] +/-   18ms
```

#### 2.2.3 Yum源

官方提示说明，CentOS 7最高支持到OpenStack Train版本，U版、V版得使用CentOS 8
```
# yum install -y centos-release-openstack-train
```

#### 2.2.4 OpenStackClient

```
# yum install -y python-openstackclient
```

#### 2.2.5 Mariadb

安装mariadb包
```
# yum install mariadb mariadb-server python2-PyMySQL
```

编辑mariadb配置
```
# vim /etc/my.cnf.d/openstack.cnf
[mysqld]
bind-address = 10.0.0.11

default-storage-engine = innodb
innodb_file_per_table = on
max_connections = 10000
collation-server = utf8_general_ci
character-set-server = utf8

key_buffer_size = '64M'
max_heap_table_size = '64M'
tmp_table_size = '64M'
innodb_buffer_pool_size = '8192M'
```

修改mariadb systemd启动脚本，因为mariadb有默认打开文件数限制
```
[root@controller1 data(keystone_admin)]# vim /usr/lib/systemd/system/mariadb.service
[Service]
...
LimitNOFILE=10000
LimitNPROC=10000
```

启动mariadb
```
# systemctl daemon-reload
# systemctl enable mariadb.service
# systemctl start mariadb.service
```

查看mariadb连接数是否生效(还是没到10000)
```
[root@controller1 data(keystone_admin)]# mysql -uroot -popenstack -e "show variables like '%connections%';"
+-----------------------+-------+
| Variable_name         | Value |
+-----------------------+-------+
| extra_max_connections | 1     |
| max_connections       | 9570  |
| max_user_connections  | 0     |
+-----------------------+-------+
```

初始化mariadb，按照提示，输入合适的root密码(这里root密码为openstack)
```
# mysql_secure_installation

NOTE: RUNNING ALL PARTS OF THIS SCRIPT IS RECOMMENDED FOR ALL MariaDB
      SERVERS IN PRODUCTION USE!  PLEASE READ EACH STEP CAREFULLY!

In order to log into MariaDB to secure it, we'll need the current
password for the root user.  If you've just installed MariaDB, and
you haven't set the root password yet, the password will be blank,
so you should just press enter here.

Enter current password for root (enter for none):
OK, successfully used password, moving on...

Setting the root password ensures that nobody can log into the MariaDB
root user without the proper authorisation.

Set root password? [Y/n] y
New password:
Re-enter new password:
Password updated successfully!
Reloading privilege tables..
 ... Success!


By default, a MariaDB installation has an anonymous user, allowing anyone
to log into MariaDB without having to have a user account created for
them.  This is intended only for testing, and to make the installation
go a bit smoother.  You should remove them before moving into a
production environment.

Remove anonymous users? [Y/n] y
 ... Success!

Normally, root should only be allowed to connect from 'localhost'.  This
ensures that someone cannot guess at the root password from the network.

Disallow root login remotely? [Y/n] n
 ... skipping.

By default, MariaDB comes with a database named 'test' that anyone can
access.  This is also intended only for testing, and should be removed
before moving into a production environment.

Remove test database and access to it? [Y/n] y
 - Dropping test database...
 ... Success!
 - Removing privileges on test database...
 ... Success!

Reloading the privilege tables will ensure that all changes made so far
will take effect immediately.

Reload privilege tables now? [Y/n] y
 ... Success!

Cleaning up...

All done!  If you've completed all of the above steps, your MariaDB
installation should now be secure.

Thanks for using MariaDB!
```

#### 2.2.6 Message queue

安装rabbitmq
```
# yum install -y rabbitmq-server
```

启动rabbitmq服务
```
# systemctl enable rabbitmq-server.service
# systemctl start rabbitmq-server.service
```

创建rabbitmq OpenStack授权用户, 并设置权限
```
# rabbitmqctl add_user openstack openstack
# rabbitmqctl set_permissions openstack ".*" ".*" ".*"
```

#### 2.2.7 Memcached

安装memcached包
```
# yum install -y memcached python-memcached
```

修改memcached配置
```
# vim /etc/sysconfig/memcached
MAXCONN="4096"
CACHESIZE="512"
OPTIONS="-l 127.0.0.1,::1,controller1"
```

启动memcached
```
# systemctl enable memcached.service
# systemctl start memcached.service
```

#### 2.2.8 Etcd

安装etcd包
```
# yum install etcd -y
```

修改etcd配置
```
# vim  /etc/etcd/etcd.conf
#[Member]
ETCD_DATA_DIR="/var/lib/etcd/default.etcd"
ETCD_LISTEN_PEER_URLS="http://172.16.88.245:2380"
ETCD_LISTEN_CLIENT_URLS="http://172.16.88.245:2379"
ETCD_NAME="controller"
#[Clustering]
ETCD_INITIAL_ADVERTISE_PEER_URLS="http://172.16.88.245:2380"
ETCD_ADVERTISE_CLIENT_URLS="http://172.16.88.245:2379"
ETCD_INITIAL_CLUSTER="controller=http://172.16.88.245:2380"
ETCD_INITIAL_CLUSTER_TOKEN="etcd-cluster-01"
ETCD_INITIAL_CLUSTER_STATE="new"
```

启动etcd
```
# systemctl enable etcd
# systemctl start etcd
```

#### 2.2.9 KeyStone

初始化keystone数据库
```
# mysql -u root -popenstack
Welcome to the MariaDB monitor.  Commands end with ; or \g.
Your MariaDB connection id is 18
Server version: 10.3.20-MariaDB MariaDB Server

Copyright (c) 2000, 2018, Oracle, MariaDB Corporation Ab and others.

Type 'help;' or '\h' for help. Type '\c' to clear the current input statement.

MariaDB [(none)]> CREATE DATABASE keystone;
Query OK, 1 row affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON keystone.* TO 'keystone'@'localhost' \
    -> IDENTIFIED BY 'keystone';
Query OK, 0 rows affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON keystone.* TO 'keystone'@'%' \
    -> IDENTIFIED BY 'keystone';
Query OK, 0 rows affected (0.000 sec)
```

安装keystone包
```
# yum install openstack-keystone httpd mod_wsgi -y
```

修改keystone配置
```
# vim /etc/keystone/keystone.conf
[database]
# ...
connection = mysql+pymysql://keystone:keystone@controller1/keystone
connection_recycle_time = 10
max_overflow = 1000
max_pool_size = 1
max_retries = -1

[cache]
backend = oslo_cache.memcache_pool
enabled = True
memcache_servers = controller1:11211

[token]
# ...
provider = fernet

[identity]
max_password_length = 128
password_hash_algorithm = pbkdf2_sha512
password_hash_rounds = 1
```

同步keystone数据库表
```
# /bin/sh -c "keystone-manage db_sync" keystone
```

初始化fernet
```
# keystone-manage fernet_setup --keystone-user keystone --keystone-group keystone
# keystone-manage credential_setup --keystone-user keystone --keystone-group keystone
```

引导identity服务，设置admin密码
```
# keystone-manage bootstrap --bootstrap-password admin \
  --bootstrap-admin-url http://controller1:5000/v3/ \
  --bootstrap-internal-url http://controller1:5000/v3/ \
  --bootstrap-public-url http://controller1:5000/v3/ \
  --bootstrap-region-id RegionOne
```

配置httpd代理keystone
```
# vim /etc/httpd/conf/httpd.conf
ServerName controller1
```

创建httpd keystone wsgi配置文件
```
# ln -s /usr/share/keystone/wsgi-keystone.conf /etc/httpd/conf.d/
```

启动httpd服务
```
# systemctl enable httpd.service
# systemctl start httpd.service
```

验证keystone服务
```
# vim keystonerc
export OS_USERNAME=admin
export OS_PASSWORD=admin
export OS_PROJECT_NAME=admin
export OS_USER_DOMAIN_NAME=Default
export OS_PROJECT_DOMAIN_NAME=Default
export OS_AUTH_URL=http://controller1:5000/v3
export OS_IDENTITY_API_VERSION=3
export PS1='[\u@\h \W(keystone_admin)]\$ '
```

```
# source keystonerc
# openstack endpoint list
+----------------------------------+-----------+--------------+--------------+---------+-----------+-----------------------------+
| ID                               | Region    | Service Name | Service Type | Enabled | Interface | URL                         |
+----------------------------------+-----------+--------------+--------------+---------+-----------+-----------------------------+
| 9e1766bdac0e4fdd9678eaf2d06a0046 | RegionOne | keystone     | identity     | True    | admin     | http://controller1:5000/v3/ |
| c17a4cb493944ca1a62aa2d632905072 | RegionOne | keystone     | identity     | True    | public    | http://controller1:5000/v3/ |
| f60ba6d5ebee4db2927cb2ec52eb8209 | RegionOne | keystone     | identity     | True    | internal  | http://controller1:5000/v3/ |
+----------------------------------+-----------+--------------+--------------+---------+-----------+-----------------------------+
# openstack token issue
+------------+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Field      | Value                                                                                                                                                                                   |
+------------+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| expires    | 2021-05-11T09:29:19+0000                                                                                                                                                                |
| id         | gAAAAABgmkBf1XpUG3MinL7rwTVIz6SEtJf-AsWYsIBpdnoCFb8cLjBjhQAHc09Hqnh7d9GK-t_Igl-XCsctKi8GRrgGm2N4Vebx9VwvRk_u9glioKOa0ZW7z0nLRjy5BoMVhUx8MHQGb7fqUcXsr8wyVkhzMhlWzRFyuaMvFk2Z9n0y1UfFMPg |
| project_id | 6f8b202e14144ed3bb1a414d308bdfd9                                                                                                                                                        |
| user_id    | 09e15386565341c8bdc89ca0555ab756                                                                                                                                                        |
+------------+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
```

创建service project
```
# openstack project create --domain default --description "Service Project" service
+-------------+----------------------------------+
| Field       | Value                            |
+-------------+----------------------------------+
| description | Service Project                  |
| domain_id   | default                          |
| enabled     | True                             |
| id          | a7667c721672424398b29ea0ef3a7c37 |
| is_domain   | False                            |
| name        | service                          |
| options     | {}                               |
| parent_id   | default                          |
| tags        | []                               |
+-------------+----------------------------------+
```

#### 2.2.10 Glance

初始化glance数据库
```
# mysql -u root -popenstack
Welcome to the MariaDB monitor.  Commands end with ; or \g.
Your MariaDB connection id is 30
Server version: 10.3.20-MariaDB MariaDB Server

Copyright (c) 2000, 2018, Oracle, MariaDB Corporation Ab and others.

Type 'help;' or '\h' for help. Type '\c' to clear the current input statement.

MariaDB [(none)]> CREATE DATABASE glance;
Query OK, 1 row affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON glance.* TO 'glance'@'localhost' \
    ->   IDENTIFIED BY 'glance';
Query OK, 0 rows affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON glance.* TO 'glance'@'%' \
    ->   IDENTIFIED BY 'glance';
Query OK, 0 rows affected (0.000 sec)
```

创建glance认证user
```
[root@controller1 ~]# openstack user create --domain default --password glance glance
+---------------------+----------------------------------+
| Field               | Value                            |
+---------------------+----------------------------------+
| domain_id           | default                          |
| enabled             | True                             |
| id                  | 633502b6cc1f4c41a3c61102535933d7 |
| name                | glance                           |
| options             | {}                               |
| password_expires_at | None                             |
+---------------------+----------------------------------+
```

赋予glance用户admin权限，并添加到service项目
```
[root@controller1 ~]# openstack role add --project service --user glance admin
```

创建glance service
```
[root@controller1 ~]# openstack service create --name glance --description "OpenStack Image" image
+-------------+----------------------------------+
| Field       | Value                            |
+-------------+----------------------------------+
| description | OpenStack Image                  |
| enabled     | True                             |
| id          | 591601b6c50f44a99ee879a1cb666480 |
| name        | glance                           |
| type        | image                            |
+-------------+----------------------------------+
```

创建glance endpoint
```
[root@controller1 ~]# openstack endpoint create --region RegionOne image public http://controller1:9292
+--------------+----------------------------------+
| Field        | Value                            |
+--------------+----------------------------------+
| enabled      | True                             |
| id           | 4b7e8fb9e51b4896a4da31bf807fcb49 |
| interface    | public                           |
| region       | RegionOne                        |
| region_id    | RegionOne                        |
| service_id   | 591601b6c50f44a99ee879a1cb666480 |
| service_name | glance                           |
| service_type | image                            |
| url          | http://controller1:9292          |
+--------------+----------------------------------+

[root@controller1 ~]# openstack endpoint create --region RegionOne image internal http://controller1:9292
+--------------+----------------------------------+
| Field        | Value                            |
+--------------+----------------------------------+
| enabled      | True                             |
| id           | 6c26f26e246e41bc98deb2e5fe27e020 |
| interface    | internal                         |
| region       | RegionOne                        |
| region_id    | RegionOne                        |
| service_id   | 591601b6c50f44a99ee879a1cb666480 |
| service_name | glance                           |
| service_type | image                            |
| url          | http://controller1:9292          |
+--------------+----------------------------------+

[root@controller1 ~]# openstack endpoint create --region RegionOne image admin http://controller1:9292
+--------------+----------------------------------+
| Field        | Value                            |
+--------------+----------------------------------+
| enabled      | True                             |
| id           | d862a7872a1f46bbb0e8f7a6ca011d5f |
| interface    | admin                            |
| region       | RegionOne                        |
| region_id    | RegionOne                        |
| service_id   | 591601b6c50f44a99ee879a1cb666480 |
| service_name | glance                           |
| service_type | image                            |
| url          | http://controller1:9292          |
+--------------+----------------------------------+
```

安装glance包
```
[root@controller1 ~]# yum install -y openstack-glance
```

编辑glance配置
```
[root@controller1 ~]# vim /etc/glance/glance-api.conf
[database]
# ...
connection = mysql+pymysql://glance:glance@controller1/glance
connection_recycle_time = 10
max_overflow = 1000
max_pool_size = 1
max_retries = -1

[keystone_authtoken]
# ...
www_authenticate_uri  = http://controller1:5000
auth_url = http://controller1:5000
memcached_servers = controller1:11211
auth_type = password
project_domain_name = Default
user_domain_name = Default
project_name = service
username = glance
password = glance

[paste_deploy]
# ...
flavor = keystone

[glance_store]
# ...
stores = file,http
default_store = file
filesystem_store_datadir = /var/lib/glance/images/
```

同步glance数据库表
```
[root@controller1 ~]# /bin/sh -c "glance-manage db_sync" glance
INFO  [alembic.runtime.migration] Context impl MySQLImpl.
INFO  [alembic.runtime.migration] Will assume non-transactional DDL.
/usr/lib/python2.7/site-packages/pymysql/cursors.py:170: Warning: (1280, u"Name 'alembic_version_pkc' ignored for PRIMARY key.")
  result = self._query(query)
INFO  [alembic.runtime.migration] Running upgrade  -> liberty, liberty initial
INFO  [alembic.runtime.migration] Running upgrade liberty -> mitaka01, add index on created_at and updated_at columns of 'images' table
INFO  [alembic.runtime.migration] Running upgrade mitaka01 -> mitaka02, update metadef os_nova_server
INFO  [alembic.runtime.migration] Running upgrade mitaka02 -> ocata_expand01, add visibility to images
INFO  [alembic.runtime.migration] Running upgrade ocata_expand01 -> pike_expand01, empty expand for symmetry with pike_contract01
INFO  [alembic.runtime.migration] Running upgrade pike_expand01 -> queens_expand01
INFO  [alembic.runtime.migration] Running upgrade queens_expand01 -> rocky_expand01, add os_hidden column to images table
INFO  [alembic.runtime.migration] Running upgrade rocky_expand01 -> rocky_expand02, add os_hash_algo and os_hash_value columns to images table
INFO  [alembic.runtime.migration] Running upgrade rocky_expand02 -> train_expand01, empty expand for symmetry with train_contract01
INFO  [alembic.runtime.migration] Context impl MySQLImpl.
INFO  [alembic.runtime.migration] Will assume non-transactional DDL.
Upgraded database to: train_expand01, current revision(s): train_expand01
INFO  [alembic.runtime.migration] Context impl MySQLImpl.
INFO  [alembic.runtime.migration] Will assume non-transactional DDL.
INFO  [alembic.runtime.migration] Context impl MySQLImpl.
INFO  [alembic.runtime.migration] Will assume non-transactional DDL.
Database migration is up to date. No migration needed.
INFO  [alembic.runtime.migration] Context impl MySQLImpl.
INFO  [alembic.runtime.migration] Will assume non-transactional DDL.
INFO  [alembic.runtime.migration] Context impl MySQLImpl.
INFO  [alembic.runtime.migration] Will assume non-transactional DDL.
INFO  [alembic.runtime.migration] Running upgrade mitaka02 -> ocata_contract01, remove is_public from images
INFO  [alembic.runtime.migration] Running upgrade ocata_contract01 -> pike_contract01, drop glare artifacts tables
INFO  [alembic.runtime.migration] Running upgrade pike_contract01 -> queens_contract01
INFO  [alembic.runtime.migration] Running upgrade queens_contract01 -> rocky_contract01
INFO  [alembic.runtime.migration] Running upgrade rocky_contract01 -> rocky_contract02
INFO  [alembic.runtime.migration] Running upgrade rocky_contract02 -> train_contract01
INFO  [alembic.runtime.migration] Context impl MySQLImpl.
INFO  [alembic.runtime.migration] Will assume non-transactional DDL.
Upgraded database to: train_contract01, current revision(s): train_contract01
INFO  [alembic.runtime.migration] Context impl MySQLImpl.
INFO  [alembic.runtime.migration] Will assume non-transactional DDL.
Database is synced successfully.
```

启动glance服务
```
# chown -R glance:glance /var/log/glance/
# systemctl enable openstack-glance-api.service
# systemctl start openstack-glance-api.service
```

验证glance服务
```
# openstack image list
```

上传cirros镜像
```
[root@controller1 data]# wget -c http://download.cirros-cloud.net/0.4.0/cirros-0.4.0-x86_64-disk.img

[root@controller1 data]# glance image-create --name "cirros" \
>   --file cirros-0.4.0-x86_64-disk.img \
>   --disk-format qcow2 --container-format bare \
>   --visibility public
+------------------+----------------------------------------------------------------------------------+
| Property         | Value                                                                            |
+------------------+----------------------------------------------------------------------------------+
| checksum         | 443b7623e27ecf03dc9e01ee93f67afe                                                 |
| container_format | bare                                                                             |
| created_at       | 2021-05-11T12:11:19Z                                                             |
| disk_format      | qcow2                                                                            |
| id               | 7abfcd41-c55c-4344-ad52-6e80716f9aca                                             |
| min_disk         | 0                                                                                |
| min_ram          | 0                                                                                |
| name             | cirros                                                                           |
| os_hash_algo     | sha512                                                                           |
| os_hash_value    | 6513f21e44aa3da349f248188a44bc304a3653a04122d8fb4535423c8e1d14cd6a153f735bb0982e |
|                  | 2161b5b5186106570c17a9e58b64dd39390617cd5a350f78                                 |
| os_hidden        | False                                                                            |
| owner            | 6f8b202e14144ed3bb1a414d308bdfd9                                                 |
| protected        | False                                                                            |
| size             | 12716032                                                                         |
| status           | active                                                                           |
| tags             | []                                                                               |
| updated_at       | 2021-05-11T12:11:20Z                                                             |
| virtual_size     | Not available                                                                    |
| visibility       | public                                                                           |
+------------------+----------------------------------------------------------------------------------+
```

#### 2.2.11 Placement

初始化placement数据库
```
[root@controller1 data]# mysql -u root -popenstack
Welcome to the MariaDB monitor.  Commands end with ; or \g.
Your MariaDB connection id is 46
Server version: 10.3.20-MariaDB MariaDB Server

Copyright (c) 2000, 2018, Oracle, MariaDB Corporation Ab and others.

Type 'help;' or '\h' for help. Type '\c' to clear the current input statement.

MariaDB [(none)]> CREATE DATABASE placement;
Query OK, 1 row affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON placement.* TO 'placement'@'localhost' \
    ->   IDENTIFIED BY 'placement';
Query OK, 0 rows affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON placement.* TO 'placement'@'%' \
    ->   IDENTIFIED BY 'placement';
Query OK, 0 rows affected (0.000 sec)
```

创建placement用户
```
[root@controller1 data]# openstack user create --domain default --password placement placement
+---------------------+----------------------------------+
| Field               | Value                            |
+---------------------+----------------------------------+
| domain_id           | default                          |
| enabled             | True                             |
| id                  | 710b09d606d74141886809a2d7ec3d2d |
| name                | placement                        |
| options             | {}                               |
| password_expires_at | None                             |
+---------------------+----------------------------------+
```

添加placement用户到service项目
```
[root@controller1 data]# openstack role add --project service --user placement admin
```

创建placement服务
```
[root@controller1 data]# openstack service create --name placement \
>   --description "Placement API" placement
+-------------+----------------------------------+
| Field       | Value                            |
+-------------+----------------------------------+
| description | Placement API                    |
| enabled     | True                             |
| id          | 792ab077eebe4178b751c76219242450 |
| name        | placement                        |
| type        | placement                        |
+-------------+----------------------------------+
```

创建placement endpoint
```
[root@controller1 data]# openstack endpoint create --region RegionOne placement public http://controller1:8778
+--------------+----------------------------------+
| Field        | Value                            |
+--------------+----------------------------------+
| enabled      | True                             |
| id           | 3479e2d9ec454572ab899710aaf2290f |
| interface    | public                           |
| region       | RegionOne                        |
| region_id    | RegionOne                        |
| service_id   | 792ab077eebe4178b751c76219242450 |
| service_name | placement                        |
| service_type | placement                        |
| url          | http://controller1:8778          |
+--------------+----------------------------------+
[root@controller1 data]# openstack endpoint create --region RegionOne placement internal http://controller1:8778
+--------------+----------------------------------+
| Field        | Value                            |
+--------------+----------------------------------+
| enabled      | True                             |
| id           | b9ff6c18366e48e3955036edcc47517f |
| interface    | internal                         |
| region       | RegionOne                        |
| region_id    | RegionOne                        |
| service_id   | 792ab077eebe4178b751c76219242450 |
| service_name | placement                        |
| service_type | placement                        |
| url          | http://controller1:8778          |
+--------------+----------------------------------+
[root@controller1 data]# openstack endpoint create --region RegionOne placement admin http://controller1:8778
+--------------+----------------------------------+
| Field        | Value                            |
+--------------+----------------------------------+
| enabled      | True                             |
| id           | ae0b1860ed10459c8bcef228f273013e |
| interface    | admin                            |
| region       | RegionOne                        |
| region_id    | RegionOne                        |
| service_id   | 792ab077eebe4178b751c76219242450 |
| service_name | placement                        |
| service_type | placement                        |
| url          | http://controller1:8778          |
+--------------+----------------------------------+
```

安装openstack-placement-api包
```
[root@controller1 data]# yum install openstack-placement-api -y
```

编辑placement配置
```
[root@controller1 data]# vim /etc/placement/placement.conf
[placement_database]
connection = mysql+pymysql://placement:placement@controller1/placement

[api]
# ...
auth_strategy = keystone

[keystone_authtoken]
# ...
auth_url = http://controller:5000/v3
memcached_servers = controller:11211
auth_type = password
project_domain_name = Default
user_domain_name = Default
project_name = service
username = placement
password = placement
```

同步placement数据库表
```
[root@controller1 data]# /bin/sh -c "placement-manage db sync" placement
/usr/lib/python2.7/site-packages/pymysql/cursors.py:170: Warning: (1280, u"Name 'alembic_version_pkc' ignored for PRIMARY key.")
  result = self._query(query)
```

编辑httpd placement配置文件
```
[root@controller1 ~]# vim /etc/httpd/conf.d/00-placement-api.conf
<VirtualHost *:8778>
......
  <Directory /usr/bin>
      <IfVersion >= 2.4>
          Require all granted
      </IfVersion>
      <IfVersion < 2.4>
          Order allow,deny
          Allow from all
      </IfVersion>
  </Directory>
</VirtualHost>
```

启动placement-api服务
```
# systemctl restart httpd
```

验证placement服务
```
[root@controller1 data]# placement-status upgrade check
+----------------------------------+
| Upgrade Check Results            |
+----------------------------------+
| Check: Missing Root Provider IDs |
| Result: Success                  |
| Details: None                    |
+----------------------------------+
| Check: Incomplete Consumers      |
| Result: Success                  |
| Details: None                    |
+----------------------------------+
```

#### 2.2.12 Nova

初始化nova数据库
```
[root@controller1 data]# mysql -u root -popenstack
Welcome to the MariaDB monitor.  Commands end with ; or \g.
Your MariaDB connection id is 52
Server version: 10.3.20-MariaDB MariaDB Server

Copyright (c) 2000, 2018, Oracle, MariaDB Corporation Ab and others.

Type 'help;' or '\h' for help. Type '\c' to clear the current input statement.

MariaDB [(none)]> CREATE DATABASE nova_api;
Query OK, 1 row affected (0.000 sec)

MariaDB [(none)]> CREATE DATABASE nova;
Query OK, 1 row affected (0.000 sec)

MariaDB [(none)]> CREATE DATABASE nova_cell0;
Query OK, 1 row affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON nova_api.* TO 'nova'@'localhost' \
    ->   IDENTIFIED BY 'nova';
Query OK, 0 rows affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON nova_api.* TO 'nova'@'%' \
    ->   IDENTIFIED BY 'nova';
Query OK, 0 rows affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON nova.* TO 'nova'@'localhost' \
    ->   IDENTIFIED BY 'nova';
Query OK, 0 rows affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON nova.* TO 'nova'@'%' \
    ->   IDENTIFIED BY 'nova';
Query OK, 0 rows affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON nova_cell0.* TO 'nova'@'localhost' \
    ->   IDENTIFIED BY 'nova';
Query OK, 0 rows affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON nova_cell0.* TO 'nova'@'%' \
    ->   IDENTIFIED BY 'nova';
Query OK, 0 rows affected (0.000 sec)
```

创建nova用户
```
[root@controller1 data]# openstack user create --domain default --password nova nova
+---------------------+----------------------------------+
| Field               | Value                            |
+---------------------+----------------------------------+
| domain_id           | default                          |
| enabled             | True                             |
| id                  | 994991c181c0455c9aef3ed1ae62f610 |
| name                | nova                             |
| options             | {}                               |
| password_expires_at | None                             |
+---------------------+----------------------------------+
```

赋予nova用户admin权限，并添加到service项目
```
[root@controller1 data]# openstack role add --project service --user nova admin
```

创建nova服务
```
[root@controller1 data]# openstack service create --name nova \
>   --description "OpenStack Compute" compute
+-------------+----------------------------------+
| Field       | Value                            |
+-------------+----------------------------------+
| description | OpenStack Compute                |
| enabled     | True                             |
| id          | 32459289053c49bd91fb375410771202 |
| name        | nova                             |
| type        | compute                          |
+-------------+----------------------------------+
```

创建nova endpoint
```
[root@controller1 data]# openstack endpoint create --region RegionOne \
>   compute public http://controller1:8774/v2.1
+--------------+----------------------------------+
| Field        | Value                            |
+--------------+----------------------------------+
| enabled      | True                             |
| id           | 4bd23d114cac4a85a2e4b055dc0cbf52 |
| interface    | public                           |
| region       | RegionOne                        |
| region_id    | RegionOne                        |
| service_id   | 32459289053c49bd91fb375410771202 |
| service_name | nova                             |
| service_type | compute                          |
| url          | http://controller1:8774/v2.1     |
+--------------+----------------------------------+
[root@controller1 data]# openstack endpoint create --region RegionOne \
>   compute internal http://controller1:8774/v2.1
+--------------+----------------------------------+
| Field        | Value                            |
+--------------+----------------------------------+
| enabled      | True                             |
| id           | a2f182824d444fd5ac5bfba72aa55967 |
| interface    | internal                         |
| region       | RegionOne                        |
| region_id    | RegionOne                        |
| service_id   | 32459289053c49bd91fb375410771202 |
| service_name | nova                             |
| service_type | compute                          |
| url          | http://controller1:8774/v2.1     |
+--------------+----------------------------------+
[root@controller1 data]# openstack endpoint create --region RegionOne \
>   compute admin http://controller1:8774/v2.1
+--------------+----------------------------------+
| Field        | Value                            |
+--------------+----------------------------------+
| enabled      | True                             |
| id           | 97c7e07b1df84addaf0a26b5d964bf82 |
| interface    | admin                            |
| region       | RegionOne                        |
| region_id    | RegionOne                        |
| service_id   | 32459289053c49bd91fb375410771202 |
| service_name | nova                             |
| service_type | compute                          |
| url          | http://controller1:8774/v2.1     |
+--------------+----------------------------------+
```

安装nova包
```
[root@controller1 data]# yum install openstack-nova-api openstack-nova-conductor   openstack-nova-novncproxy openstack-nova-scheduler
```

编辑nova配置
```
[root@controller1 data]# vim /etc/nova/nova.conf
[DEFAULT]
# ...
enabled_apis = osapi_compute,metadata
transport_url = rabbit://openstack:openstack@controller1:5672/
my_ip = 172.16.88.245
use_neutron = true
firewall_driver = nova.virt.firewall.NoopFirewallDriver

[cache]
backend = oslo_cache.memcache_pool
enabled = True
memcache_servers = controller1:11211

[api_database]
# ...
connection = mysql+pymysql://nova:nova@controller1/nova_api
connection_recycle_time = 10
max_overflow = 1000
max_pool_size = 1
max_retries = -1

[database]
# ...
connection = mysql+pymysql://nova:nova@controller1/nova
connection_recycle_time = 10
max_overflow = 1000
max_pool_size = 1
max_retries = -1

[api]
# ...
auth_strategy = keystone

[keystone_authtoken]
# ...
www_authenticate_uri = http://controller1:5000/
auth_url = http://controller1:5000/
memcached_servers = controller1:11211
auth_type = password
project_domain_name = Default
user_domain_name = Default
project_name = service
username = nova
password = nova

[vnc]
enabled = true
# ...
server_listen = 172.16.88.245
server_proxyclient_address = 172.16.88.245
novncproxy_base_url = http://controller1:6080/vnc_auto.html

[glance]
# ...
api_servers = http://controller1:9292

[oslo_concurrency]
# ...
lock_path = /var/lib/nova/tmp

[placement]
# ...
region_name = RegionOne
project_domain_name = Default
project_name = service
auth_type = password
user_domain_name = Default
auth_url = http://controller1:5000/v3
username = placement
password = placement
```

同步nova-api数据库表
```
[root@controller1 data]# /bin/sh -c "nova-manage api_db sync" nova
```

注册cell0数据库
```
[root@controller1 ~]# /bin/sh -c "nova-manage cell_v2 map_cell0" nova
Cell0 is already setup
```

创建cell1 cell
```
[root@controller1 ~]# /bin/sh -c "nova-manage cell_v2 create_cell --name=cell1 --verbose" nova
a16bf78a-8657-4717-9037-f14428c7eceb
```

同步nova数据库表
```
[root@controller1 ~]# /bin/sh -c "nova-manage db sync" nova
/usr/lib/python2.7/site-packages/pymysql/cursors.py:170: Warning: (1831, u'Duplicate index `block_device_mapping_instance_uuid_virtual_name_device_name_idx`. This is deprecated and will be disallowed in a future release')
  result = self._query(query)
/usr/lib/python2.7/site-packages/pymysql/cursors.py:170: Warning: (1831, u'Duplicate index `uniq_instances0uuid`. This is deprecated and will be disallowed in a future release')
  result = self._query(query)
```

验证nova cell0、cell1是否注册成功
```
[root@controller1 ~]# /bin/sh -c "nova-manage cell_v2 list_cells" nova
+-------+--------------------------------------+-------------------------------------------+--------------------------------------------------+----------+
|  Name |                 UUID                 |               Transport URL               |               Database Connection                | Disabled |
+-------+--------------------------------------+-------------------------------------------+--------------------------------------------------+----------+
| cell0 | 00000000-0000-0000-0000-000000000000 |                   none:/                  | mysql+pymysql://nova:****@controller1/nova_cell0 |  False   |
| cell1 | a16bf78a-8657-4717-9037-f14428c7eceb | rabbit://openstack:****@controller1:5672/ |    mysql+pymysql://nova:****@controller1/nova    |  False   |
+-------+--------------------------------------+-------------------------------------------+--------------------------------------------------+----------+
```

启动nova服务
```
# systemctl enable \
    openstack-nova-api.service \
    openstack-nova-scheduler.service \
    openstack-nova-conductor.service \
    openstack-nova-novncproxy.service
# systemctl start \
    openstack-nova-api.service \
    openstack-nova-scheduler.service \
    openstack-nova-conductor.service \
    openstack-nova-novncproxy.service
```

待添加完计算节点后，可以执行以下操作进行服务验证：
1、查看nova服务列表
```
[root@controller1 ~]# openstack compute service list
+----+----------------+-------------+----------+---------+-------+----------------------------+
| ID | Binary         | Host        | Zone     | Status  | State | Updated At                 |
+----+----------------+-------------+----------+---------+-------+----------------------------+
|  1 | nova-conductor | controller1 | internal | enabled | up    | 2021-05-12T03:37:43.000000 |
|  3 | nova-scheduler | controller1 | internal | enabled | up    | 2021-05-12T03:37:49.000000 |
|  8 | nova-compute   | computer1   | nova     | enabled | up    | 2021-05-12T03:37:51.000000 |
| 11 | nova-compute   | controller1 | nova     | enabled | up    | 2021-05-12T03:37:52.000000 |
+----+----------------+-------------+----------+---------+-------+----------------------------+
```

2、查看API endpoints列表
```
[root@controller1 ~]# openstack catalog list
+-----------+-----------+------------------------------------------+
| Name      | Type      | Endpoints                                |
+-----------+-----------+------------------------------------------+
| keystone  | identity  | RegionOne                                |
|           |           |   admin: http://controller1:5000/v3/     |
|           |           | RegionOne                                |
|           |           |   public: http://controller1:5000/v3/    |
|           |           | RegionOne                                |
|           |           |   internal: http://controller1:5000/v3/  |
|           |           |                                          |
| nova      | compute   | RegionOne                                |
|           |           |   public: http://controller1:8774/v2.1   |
|           |           | RegionOne                                |
|           |           |   admin: http://controller1:8774/v2.1    |
|           |           | RegionOne                                |
|           |           |   internal: http://controller1:8774/v2.1 |
|           |           |                                          |
| glance    | image     | RegionOne                                |
|           |           |   public: http://controller1:9292        |
|           |           | RegionOne                                |
|           |           |   internal: http://controller1:9292      |
|           |           | RegionOne                                |
|           |           |   admin: http://controller1:9292         |
|           |           |                                          |
| placement | placement | RegionOne                                |
|           |           |   public: http://controller1:8778        |
|           |           | RegionOne                                |
|           |           |   admin: http://controller1:8778         |
|           |           | RegionOne                                |
|           |           |   internal: http://controller1:8778      |
|           |           |                                          |
+-----------+-----------+------------------------------------------+
```

3、查看镜像列表
```
[root@controller1 ~]# openstack image list
+--------------------------------------+--------+--------+
| ID                                   | Name   | Status |
+--------------------------------------+--------+--------+
| 7abfcd41-c55c-4344-ad52-6e80716f9aca | cirros | active |
+--------------------------------------+--------+--------+
```

4、校验cells和placement API是否工作正常
```
[root@controller1 ~]# nova-status upgrade check
+--------------------------------+
| Upgrade Check Results          |
+--------------------------------+
| Check: Cells v2                |
| Result: Success                |
| Details: None                  |
+--------------------------------+
| Check: Placement API           |
| Result: Success                |
| Details: None                  |
+--------------------------------+
| Check: Ironic Flavor Migration |
| Result: Success                |
| Details: None                  |
+--------------------------------+
| Check: Cinder API              |
| Result: Success                |
| Details: None                  |
+--------------------------------+
```

#### 2.2.13 Neutron

初始化neutron数据库
```
[root@controller1 ~]# mysql -u root -popenstack
Welcome to the MariaDB monitor.  Commands end with ; or \g.
Your MariaDB connection id is 7396
Server version: 10.3.20-MariaDB MariaDB Server

Copyright (c) 2000, 2018, Oracle, MariaDB Corporation Ab and others.

Type 'help;' or '\h' for help. Type '\c' to clear the current input statement.

MariaDB [(none)]> CREATE DATABASE neutron;
Query OK, 1 row affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON neutron.* TO 'neutron'@'localhost' \
    ->   IDENTIFIED BY 'neutron';
Query OK, 0 rows affected (0.001 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON neutron.* TO 'neutron'@'%' \
    ->   IDENTIFIED BY 'neutron';
Query OK, 0 rows affected (0.000 sec)
```

创建neutron用户
```
[root@controller1 ~]# openstack user create --domain default --password neutron neutron
+---------------------+----------------------------------+
| Field               | Value                            |
+---------------------+----------------------------------+
| domain_id           | default                          |
| enabled             | True                             |
| id                  | a8c22e883b3a44f2b2b93bda0bfbc1c2 |
| name                | neutron                          |
| options             | {}                               |
| password_expires_at | None                             |
+---------------------+----------------------------------+
```

授予neutron用户admin权限，并添加到service项目
```
[root@controller1 ~]# openstack role add --project service --user neutron admin
```

创建neutron服务
```
[root@controller1 ~]# openstack service create --name neutron \
>   --description "OpenStack Networking" network

+-------------+----------------------------------+
| Field       | Value                            |
+-------------+----------------------------------+
| description | OpenStack Networking             |
| enabled     | True                             |
| id          | 8986d22b17954afa8c8616862c1b61d3 |
| name        | neutron                          |
| type        | network                          |
+-------------+----------------------------------+
```

创建neutron endpoint
```
[root@controller1 ~]# openstack endpoint create --region RegionOne network public http://controller1:9696
+--------------+----------------------------------+
| Field        | Value                            |
+--------------+----------------------------------+
| enabled      | True                             |
| id           | cb46fdc6723747059ff51e2b458c1ebf |
| interface    | public                           |
| region       | RegionOne                        |
| region_id    | RegionOne                        |
| service_id   | 8986d22b17954afa8c8616862c1b61d3 |
| service_name | neutron                          |
| service_type | network                          |
| url          | http://controller1:9696          |
+--------------+----------------------------------+

[root@controller1 ~]# openstack endpoint create --region RegionOne network internal http://controller1:9696
+--------------+----------------------------------+
| Field        | Value                            |
+--------------+----------------------------------+
| enabled      | True                             |
| id           | e6e96552557e4c668fcfead75afeb4a8 |
| interface    | internal                         |
| region       | RegionOne                        |
| region_id    | RegionOne                        |
| service_id   | 8986d22b17954afa8c8616862c1b61d3 |
| service_name | neutron                          |
| service_type | network                          |
| url          | http://controller1:9696          |
+--------------+----------------------------------+

[root@controller1 ~]# openstack endpoint create --region RegionOne network admin http://controller1:9696
+--------------+----------------------------------+
| Field        | Value                            |
+--------------+----------------------------------+
| enabled      | True                             |
| id           | 4e2841ebfbe14bf4b8c24a5cbc5edf85 |
| interface    | admin                            |
| region       | RegionOne                        |
| region_id    | RegionOne                        |
| service_id   | 8986d22b17954afa8c8616862c1b61d3 |
| service_name | neutron                          |
| service_type | network                          |
| url          | http://controller1:9696          |
+--------------+----------------------------------+
```

安装neutron包
```
[root@controller1 ~]# yum install -y openstack-neutron openstack-neutron-ml2 \
    openstack-neutron-linuxbridge ebtables
```

编辑neutron配置文件（使用linuxbridge）
```
# vim /etc/neutron/neutron.conf
[database]
# ...
connection = mysql+pymysql://neutron:NEUTRON_DBPASS@controller/neutron
connection_recycle_time = 10
max_overflow = 1000
max_pool_size = 1
max_retries = -1

[DEFAULT]
# ...
core_plugin = ml2
service_plugins = router
allow_overlapping_ips = true
transport_url = rabbit://openstack:openstack@controller1:5672/
auth_strategy = keystone
notify_nova_on_port_status_changes = true
notify_nova_on_port_data_changes = true

[keystone_authtoken]
# ...
www_authenticate_uri = http://controller1:5000
auth_url = http://controller1:5000
memcached_servers = controller1:11211
auth_type = password
project_domain_name = default
user_domain_name = default
project_name = service
username = neutron
password = neturon

[nova]
# ...
auth_url = http://controller1:5000
auth_type = password
project_domain_name = default
user_domain_name = default
region_name = RegionOne
project_name = service
username = nova
password = nova

[oslo_concurrency]
# ...
lock_path = /var/lib/neutron/tmp
```

编辑ml2配置文件
```
# vim /etc/neutron/plugins/ml2/ml2_conf.ini
[ml2]
# ...
type_drivers = flat,vlan,vxlan
tenant_network_types = vxlan

mechanism_drivers = linuxbridge,l2population
extension_drivers = port_security

[ml2_type_flat]
# ...
flat_networks = provider

[ml2_type_vxlan]
# ...
vni_ranges = 1:1000

[securitygroup]
# ...
enable_ipset = true
```

编辑linuxbridge配置文件
```
# vim /etc/neutron/plugins/ml2/linuxbridge_agent.ini
[linux_bridge]
physical_interface_mappings = provider:em3

[vxlan]
enable_vxlan = true
local_ip = 172.16.88.245
l2_population = true

[securitygroup]
# ...
enable_security_group = true
firewall_driver = neutron.agent.linux.iptables_firewall.IptablesFirewallDriver
```

编辑sysctl.conf配置
```
# vim /etc/sysctl.conf
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1

# sysctl -p
```

编辑l3配置文件
```
[root@controller1 ~]# vim /etc/neutron/l3_agent.ini
[DEFAULT]
interface_driver = linuxbridge
dhcp_driver = neutron.agent.linux.dhcp.Dnsmasq
enable_isolated_metadata = true
```

编辑metadata配置文件
```
[root@controller1 ~]# vim /etc/neutron/metadata_agent.ini
[DEFAULT]
# ...
nova_metadata_host = controller1
metadata_proxy_shared_secret = METADATA_SECRET
```

编辑nova配置，nova与neutron交互
```
[root@controller1 ~]# vim /etc/nova/nova.conf
[neutron]
# ...
auth_url = http://controller1:5000
auth_type = password
project_domain_name = default
user_domain_name = default
region_name = RegionOne
project_name = service
username = neutron
password = neutron
service_metadata_proxy = true
metadata_proxy_shared_secret = METADATA_SECRET
```

创建软链接，neutron-server systemd启动脚步读取的是`/etc/neutron/plugin.ini`配置文件
```
[root@controller1 ~]# ln -s /etc/neutron/plugins/ml2/ml2_conf.ini /etc/neutron/plugin.ini
```

同步neutron数据库表
```
[root@controller1 ~]# /bin/sh -c "neutron-db-manage --config-file /etc/neutron/neutron.conf \
>   --config-file /etc/neutron/plugins/ml2/ml2_conf.ini upgrade head" neutron
```

重启nova api服务
```
[root@controller1 ~]# systemctl restart openstack-nova-api.service
```

启动neutron服务
```
[root@controller1 ~]# systemctl enable neutron-server.service \
>   neutron-linuxbridge-agent.service neutron-dhcp-agent.service \
>   neutron-metadata-agent.service \
>   neutron-l3-agent.service

[root@controller1 ~]# systemctl start neutron-server.service \
>   neutron-linuxbridge-agent.service neutron-dhcp-agent.service \
>   neutron-metadata-agent.service \
>   neutron-l3-agent.service
```

#### 2.2.14 Cinder

初始化cinder数据库
```
[root@controller1 ~]# mysql -u root -popenstack
Welcome to the MariaDB monitor.  Commands end with ; or \g.
Your MariaDB connection id is 26397
Server version: 10.3.20-MariaDB MariaDB Server

Copyright (c) 2000, 2018, Oracle, MariaDB Corporation Ab and others.

Type 'help;' or '\h' for help. Type '\c' to clear the current input statement.

MariaDB [(none)]> CREATE DATABASE cinder;
Query OK, 1 row affected (0.000 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON cinder.* TO 'cinder'@'localhost' \
    ->   IDENTIFIED BY 'cinder';
Query OK, 0 rows affected (0.001 sec)

MariaDB [(none)]> GRANT ALL PRIVILEGES ON cinder.* TO 'cinder'@'%' \
    ->   IDENTIFIED BY 'cinder';
Query OK, 0 rows affected (0.000 sec)
```

创建cinder用户
```
[root@controller1 ~]# openstack user create --domain default --password cinder cinder

+---------------------+----------------------------------+
| Field               | Value                            |
+---------------------+----------------------------------+
| domain_id           | default                          |
| enabled             | True                             |
| id                  | 58104291fa634ea2a72b28864d2700a9 |
| name                | cinder                           |
| options             | {}                               |
| password_expires_at | None                             |
+---------------------+----------------------------------+
```

授予cindder用户admin权限，并添加到service项目
```
[root@controller1 ~]# openstack role add --project service --user cinder admin
```

创建cinder v2服务
```
[root@controller1 ~]# openstack service create --name cinderv2 \
>   --description "OpenStack Block Storage" volumev2
+-------------+----------------------------------+
| Field       | Value                            |
+-------------+----------------------------------+
| description | OpenStack Block Storage          |
| enabled     | True                             |
| id          | 7ce339c0607247c3977588117cc55c93 |
| name        | cinderv2                         |
| type        | volumev2                         |
+-------------+----------------------------------+
```

创建cinder v3服务
```
[root@controller1 ~]# openstack service create --name cinderv3 \
>   --description "OpenStack Block Storage" volumev3
+-------------+----------------------------------+
| Field       | Value                            |
+-------------+----------------------------------+
| description | OpenStack Block Storage          |
| enabled     | True                             |
| id          | f29317ffd14640468a052452d727f94c |
| name        | cinderv3                         |
| type        | volumev3                         |
+-------------+----------------------------------+
```

创建cinder v2 endpoint
```
[root@controller1 ~]# openstack endpoint create --region RegionOne \
volumev2 public http://controller1:8776/v2/%\(project_id\)s
+--------------+-------------------------------------------+
| Field        | Value                                     |
+--------------+-------------------------------------------+
| enabled      | True                                      |
| id           | 16552ff4fb3846b790f63337f85fed5a          |
| interface    | public                                    |
| region       | RegionOne                                 |
| region_id    | RegionOne                                 |
| service_id   | 7ce339c0607247c3977588117cc55c93          |
| service_name | cinderv2                                  |
| service_type | volumev2                                  |
| url          | http://controller1:8776/v2/%(project_id)s |
+--------------+-------------------------------------------+

[root@controller1 ~]# openstack endpoint create --region RegionOne \
volumev2 internal http://controller1:8776/v2/%\(project_id\)s
+--------------+-------------------------------------------+
| Field        | Value                                     |
+--------------+-------------------------------------------+
| enabled      | True                                      |
| id           | 278352f982b849f4a9c5982218b01db4          |
| interface    | internal                                  |
| region       | RegionOne                                 |
| region_id    | RegionOne                                 |
| service_id   | 7ce339c0607247c3977588117cc55c93          |
| service_name | cinderv2                                  |
| service_type | volumev2                                  |
| url          | http://controller1:8776/v2/%(project_id)s |
+--------------+-------------------------------------------+

[root@controller1 ~]# openstack endpoint create --region RegionOne \
volumev2 admin http://controller1:8776/v2/%\(project_id\)s
+--------------+-------------------------------------------+
| Field        | Value                                     |
+--------------+-------------------------------------------+
| enabled      | True                                      |
| id           | 4acda7fa4ce849e7a48858607eb35f40          |
| interface    | admin                                     |
| region       | RegionOne                                 |
| region_id    | RegionOne                                 |
| service_id   | 7ce339c0607247c3977588117cc55c93          |
| service_name | cinderv2                                  |
| service_type | volumev2                                  |
| url          | http://controller1:8776/v2/%(project_id)s |
+--------------+-------------------------------------------+
```

创建cinder v3 endpoint
```
[root@controller1 ~]# openstack endpoint create --region RegionOne \
volumev3 public http://controller1:8776/v3/%\(project_id\)s
+--------------+-------------------------------------------+
| Field        | Value                                     |
+--------------+-------------------------------------------+
| enabled      | True                                      |
| id           | ed063de851e34eafbee64efcd8061d2b          |
| interface    | public                                    |
| region       | RegionOne                                 |
| region_id    | RegionOne                                 |
| service_id   | f29317ffd14640468a052452d727f94c          |
| service_name | cinderv3                                  |
| service_type | volumev3                                  |
| url          | http://controller1:8776/v3/%(project_id)s |
+--------------+-------------------------------------------+

[root@controller1 ~]# openstack endpoint create --region RegionOne \
volumev3 internal http://controller1:8776/v3/%\(project_id\)s
+--------------+-------------------------------------------+
| Field        | Value                                     |
+--------------+-------------------------------------------+
| enabled      | True                                      |
| id           | 8b98c04c6fc7444da90cbc2692e735a1          |
| interface    | internal                                  |
| region       | RegionOne                                 |
| region_id    | RegionOne                                 |
| service_id   | f29317ffd14640468a052452d727f94c          |
| service_name | cinderv3                                  |
| service_type | volumev3                                  |
| url          | http://controller1:8776/v3/%(project_id)s |
+--------------+-------------------------------------------+

[root@controller1 ~]# openstack endpoint create --region RegionOne \
volumev3 admin http://controller1:8776/v3/%\(project_id\)s
+--------------+-------------------------------------------+
| Field        | Value                                     |
+--------------+-------------------------------------------+
| enabled      | True                                      |
| id           | d7d98fee7cf44ac6bdaf6edaae3456a0          |
| interface    | admin                                     |
| region       | RegionOne                                 |
| region_id    | RegionOne                                 |
| service_id   | f29317ffd14640468a052452d727f94c          |
| service_name | cinderv3                                  |
| service_type | volumev3                                  |
| url          | http://controller1:8776/v3/%(project_id)s |
+--------------+-------------------------------------------+
```

安装cinder安装包
```
[root@controller1 ~]# yum install openstack-cinder -y
```

编辑cinder配置文件
```
[root@controller1 ~]# vim /etc/cinder/cinder.conf
[DEFAULT]
transport_url = rabbit://openstack:openstack@controller1:5672/
auth_strategy = keystone
my_ip = 172.16.88.245

[database]
connection = mysql+pymysql://cinder:cinder@controller1/cinder
connection_recycle_time = 10
max_overflow = 1000
max_pool_size = 1
max_retries = -1

[keystone_authtoken]
www_authenticate_uri = http://controller1:5000
auth_url = http://controller1:5000
memcached_servers = controller1:11211
auth_type = password
project_domain_name = default
user_domain_name = default
project_name = service
username = cinder
password = cinder

[oslo_concurrency]
lock_path = /var/lib/cinder/tmp
```

同步cinder数据库表
```
[root@controller1 ~]#  /bin/sh -c "cinder-manage db sync" cinder
Deprecated: Option "logdir" from group "DEFAULT" is deprecated. Use option "log-dir" from group "DEFAULT".
```

配置nova使用cinder
```
[root@controller1 ~]# vim /etc/nova/nova.conf
[cinder]
os_region_name = RegionOne
```

重启nova-api服务
```
[root@controller1 ~]# systemctl restart openstack-nova-api.service
```

启动cinder服务
```
[root@controller1 ~]# systemctl enable openstack-cinder-api.service openstack-cinder-scheduler.service
Created symlink from /etc/systemd/system/multi-user.target.wants/openstack-cinder-api.service to /usr/lib/systemd/system/openstack-cinder-api.service.
Created symlink from /etc/systemd/system/multi-user.target.wants/openstack-cinder-scheduler.service to /usr/lib/systemd/system/openstack-cinder-scheduler.service.

[root@controller1 ~]# systemctl start openstack-cinder-api.service openstack-cinder-scheduler.service
```

配置storage节点（以LVM为例）
```
# yum install lvm2 device-mapper-persistent-data openstack-cinder targetcli python-keystone
```

启动lvm元数据服务
```
# systemctl enable lvm2-lvmetad.service
# systemctl start lvm2-lvmetad.service
```

模拟LVM（节点上没有多余的盘）
```
[root@controller1 data(keystone_admin)]# fallocate -l 2T cinder-volumes
[root@controller1 data(keystone_admin)]# losetup -f cinder-volumes
[root@controller1 data(keystone_admin)]# losetup -a
/dev/loop0: [64768]:567 (/data/cinder-volumes)
```

编辑lvm配置文件, 允许/dev/loop0设备
```
[root@controller1 data(keystone_admin)]# vim /etc/lvm/lvm.conf
filter = [ "a|loop0|", "r|.*|" ]
```

```
[root@controller1 data(keystone_admin)]# vim /etc/cinder/cinder.conf
[DEFAULT]
# ...
enabled_backends = lvm
[lvm]
volume_driver = cinder.volume.drivers.lvm.LVMVolumeDriver
volume_group = cinder-volumes
target_protocol = iscsi
target_helper = lioadm
```

启动cinder-volume服务
```
[root@controller1 data(keystone_admin)]# systemctl enable openstack-cinder-volume.service target.service
[root@controller1 data(keystone_admin)]# systemctl start openstack-cinder-volume.service target.service
```

验证cinder服务
```
[root@controller1 data(keystone_admin)]# openstack volume service list
+------------------+-----------------+------+---------+-------+----------------------------+
| Binary           | Host            | Zone | Status  | State | Updated At                 |
+------------------+-----------------+------+---------+-------+----------------------------+
| cinder-scheduler | controller1     | nova | enabled | up    | 2021-05-20T11:28:20.000000 |
| cinder-volume    | controller1@lvm | nova | enabled | up    | 2021-05-20T11:28:21.000000 |
+------------------+-----------------+------+---------+-------+----------------------------+
```

cinder-volume对接ceph(待验证)
```
# 创建cinder pool
[root@ceph-1 ~]# ceph osd pool create cinder 128
````

创建ceph cinder用户
```
[root@ceph-1 ~]# ceph auth get-or-create client.cinder mon 'allow r' osd 'allow class-read object_prefix rbd_children, allow rwx pool=cinder'
[client.cinder]
	key = AQBIVKZgGHE2MxAAAYlmJJaoe4/u6AalEnuSAQ==
```
创建`/etc/cinder/ceph.client.cinder.keyring`文件，拷贝/etc/ceph目录到glance-api、cinder-volume、cinder-backup、nova-compute节点上

增加rbd配置，配置cinder多后端
```
[root@controller1 ~]# vim /etc/cinder/cinder.conf
[DEFAULT]
enabled_backends=lvm,rbd
default_volume_type = lvm

[rbd]
volume_driver = cinder.volume.drivers.rbd.RBDDriver
rbd_pool = rbd
rbd_ceph_conf = /etc/ceph/ceph.conf
rbd_flatten_volume_from_snapshot = false
rbd_max_clone_depth = 5
rbd_store_chunk_size = 4
rados_connect_timeout = -1
glance_api_version = 2
rbd_user = rbd
rbd_secret_uuid = aa03e7e8-6fcc-443f-94aa-ac169bfd0fd5
```

创建lvm和rbd类型
```
[root@controller1 data(keystone_admin)]# cinder type-create lvm
+--------------------------------------+------+-------------+-----------+
| ID                                   | Name | Description | Is_Public |
+--------------------------------------+------+-------------+-----------+
| e55deb0f-5b79-4d51-93e1-cf5b9123d2b7 | lvm  | -           | True      |
+--------------------------------------+------+-------------+-----------+
[root@controller1 data(keystone_admin)]# cinder type-create rbd
+--------------------------------------+------+-------------+-----------+
| ID                                   | Name | Description | Is_Public |
+--------------------------------------+------+-------------+-----------+
| 99f79886-3f9a-4db5-8410-903738fd3c0b | rbd  | -           | True      |
+--------------------------------------+------+-------------+-----------+

[root@controller1 data(keystone_admin)]# cinder type-key lvm set volume_backend_name=lvm
[root@controller1 data(keystone_admin)]# cinder type-key rbd set volume_backend_name=rbd
```

#### 2.2.15 Horizon

安装horizon包
```
[root@controller1 ~]# yum install -y openstack-dashboard
```

编辑horizon配置文件
```
[root@controller1 ~]# vim /etc/openstack-dashboard/local_settings
COMPRESS_OFFLINE = True
WEBROOT = '/dashboard/'
OPENSTACK_HOST = "controller1"
ALLOWED_HOSTS = ['*']

SESSION_ENGINE = 'django.contrib.sessions.backends.cache'

CACHES = {
    'default': {
         'BACKEND': 'django.core.cache.backends.memcached.MemcachedCache',
         'LOCATION': 'controller1:11211',
    }
}

OPENSTACK_KEYSTONE_MULTIDOMAIN_SUPPORT = True
OPENSTACK_API_VERSIONS = {
    "identity": 3,
    "image": 2,
    "volume": 3,
}

OPENSTACK_KEYSTONE_DEFAULT_DOMAIN = "Default"
OPENSTACK_KEYSTONE_DEFAULT_ROLE = "member"

OPENSTACK_KEYSTONE_BACKEND = {
    'name': 'native',
    'can_edit_user': True,
    'can_edit_group': True,
    'can_edit_project': True,
    'can_edit_domain': True,
    'can_edit_role': True,
}

OPENSTACK_HYPERVISOR_FEATURES = {
    'can_set_mount_point': False,
    'can_set_password': False,
    'requires_keypair': False,
    'enable_quotas': True
}

OPENSTACK_CINDER_FEATURES = {
    'enable_backup': True,
}

TIME_ZONE = "Asia/Shanghai"
# Path to directory containing policy.json files
POLICY_FILES_PATH = '/etc/openstack-dashboard'
```

编辑horizon httpd配置文件
```
[root@controller1 ~]# vim /etc/httpd/conf.d/openstack-dashboard.conf
```

重启httpd服务
```
[root@controller1 ~]# systemctl status httpd.service
```
登录`http://<controller-ip>/dashboard`访问

tips: 界面logo修改路径
```
[root@controller1 img]# ll /usr/share/openstack-dashboard/static/dashboard/img/logo-splash.svg
-rw-r--r-- 1 root root 9632 May 13 20:48 /usr/share/openstack-dashboard/static/dashboard/img/logo-splash.svg
[root@controller1 img]# ll /usr/share/openstack-dashboard/static/dashboard/img/logo.svg
-rw-r--r-- 1 root root 9632 May 13 20:50 /usr/share/openstack-dashboard/static/dashboard/img/logo.svg
```

### 2.3 Compute Node

#### 2.3.1 静态域名解析

```
# vim /etc/hosts
127.0.0.1   localhost localhost.localdomain localhost4 localhost4.localdomain4
::1         localhost localhost.localdomain localhost6 localhost6.localdomain6

172.16.88.245 controller1
172.16.88.246 computer1
```

#### 2.3.2 NTP

安装chrony
```
# yum install -y chrony
```

编辑chrony配置(移除原来的server块区域)
```
# vim /etc/chrony.conf
server controller1 iburst
```

启动chrony
```
# systemctl enable chronyd.service
# systemctl restart chronyd.service
```

查看NTP同步情况
```
# chronyc sources
210 Number of sources = 1
MS Name/IP address         Stratum Poll Reach LastRx Last sample
===============================================================================
^* controller1                   3   6   177    40   +111us[ +207us] +/-   16ms
```

#### 2.3.3 Yum源

安装OpenStack train源
```
# yum install -y centos-release-openstack-train
```

#### 2.3.4 Nova

编辑nova配置
```
[root@controller1 data]# vim /etc/nova/nova.conf
[DEFAULT]
# ...
enabled_apis = osapi_compute,metadata
transport_url = rabbit://openstack:openstack@controller1:5672/
my_ip = 172.16.88.245
use_neutron = true
firewall_driver = nova.virt.firewall.NoopFirewallDriver
cpu_allocation_ratio=4.0
ram_allocation_ratio=1.0
disk_allocation_ratio=1.0
reserved_host_memory_mb=4096

[api]
# ...
auth_strategy = keystone

[keystone_authtoken]
# ...
www_authenticate_uri = http://controller1:5000/
auth_url = http://controller1:5000/
memcached_servers = controller1:11211
auth_type = password
project_domain_name = Default
user_domain_name = Default
project_name = service
username = nova
password = nova

[vnc]
enabled = true
# ...
server_listen = 172.16.88.245
server_proxyclient_address = 172.16.88.245
novncproxy_base_url = http://controller1:6080/vnc_auto.html

[glance]
# ...
api_servers = http://controller1:9292

[oslo_concurrency]
# ...
lock_path = $state_path/tmp

[placement]
# ...
region_name = RegionOne
project_domain_name = Default
project_name = service
auth_type = password
user_domain_name = Default
auth_url = http://controller1:5000/v3
username = placement
password = placement
```

查看节点是否开启VT硬件加速
```
[root@computer1 ~]# egrep -c '(vmx|svm)' /proc/cpuinfo
48
```
如果返回为0的话，即没有开启VT，需要配置`virt_type=qemu`

启动nova compute服务
```
# systemctl enable libvirtd.service openstack-nova-compute.service
# systemctl start libvirtd.service openstack-nova-compute.service
```

查看nova compute服务
```
[root@controller1 ~]# openstack compute service list --service nova-compute
+----+--------------+-------------+------+---------+-------+----------------------------+
| ID | Binary       | Host        | Zone | Status  | State | Updated At                 |
+----+--------------+-------------+------+---------+-------+----------------------------+
|  8 | nova-compute | computer1   | nova | enabled | up    | 2021-05-12T01:43:01.000000 |
|  9 | nova-compute | controller1 | nova | enabled | up    | 2021-05-12T01:42:54.000000 |
+----+--------------+-------------+------+---------+-------+----------------------------+
```

注册新计算节点到cell数据库（controller节点上操作）
```
[root@controller1 ~]# /bin/sh -c "nova-manage cell_v2 discover_hosts --verbose" nova
```
也可以使用cell自动发现功能，通过设置
```
# vim /etc/nova/nova.conf
[scheduler]
discover_hosts_in_cells_interval = 300
```

#### 2.3.5 Neutron

安装neutron包
```
[root@computer1 ~]# yum install openstack-neutron-linuxbridge ebtables ipset -y
```

编辑neutron配置文件
```
[root@computer1 ~]# vim /etc/neutron/neutron.conf
[DEFAULT]
transport_url = rabbit://openstack:openstack@controller1:5672/
auth_strategy = keystone

[keystone_authtoken]
# ...
www_authenticate_uri = http://controller1:5000
auth_url = http://controller1:5000
memcached_servers = controller1:11211
auth_type = password
project_domain_name = default
user_domain_name = default
project_name = service
username = neutron
password = neutron

[oslo_concurrency]
# ...
lock_path = /var/lib/neutron/tmp
```

编辑ml2配置文件
```
[root@computer1 ~]# vim /etc/neutron/plugins/ml2/linuxbridge_agent.ini
[linux_bridge]
physical_interface_mappings = provider:em3

[vxlan]
enable_vxlan = true
local_ip = 172.16.88.246
l2_population = true

[securitygroup]
# ...
enable_security_group = true
firewall_driver = neutron.agent.linux.iptables_firewall.IptablesFirewallDriver
```

编辑sysctl.conf配置
```
# vim /etc/sysctl.conf
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1

# sysctl -p
```

编辑nova配置，nova与neutron交互
```
[root@controller1 ~]# vim /etc/nova/nova.conf
[neutron]
# ...
auth_url = http://controller1:5000
auth_type = password
project_domain_name = default
user_domain_name = default
region_name = RegionOne
project_name = service
username = neutron
password = neutron
```

重启nova compute服务
```
[root@computer1 ~]# systemctl restart openstack-nova-compute.service
```

启动linux-bridge-agent服务
```
[root@computer1 ~]# systemctl enable neutron-linuxbridge-agent.service
[root@computer1 ~]# systemctl start neutron-linuxbridge-agent.service
```

验证neutron agent服务列表
```
[root@controller1 ~]#  openstack network agent list
+--------------------------------------+--------------------+-------------+-------------------+-------+-------+---------------------------+
| ID                                   | Agent Type         | Host        | Availability Zone | Alive | State | Binary                    |
+--------------------------------------+--------------------+-------------+-------------------+-------+-------+---------------------------+
| 2ec756b4-0313-4ca2-b77f-4c8ae82f4034 | DHCP agent         | controller1 | nova              | :-)   | UP    | neutron-dhcp-agent        |
| 97e383a7-c06e-4f3b-8352-3d54b89ad591 | L3 agent           | controller1 | nova              | :-)   | UP    | neutron-l3-agent          |
| a95ab80a-dd80-49bb-ac86-6eeb31264483 | Linux bridge agent | computer1   | None              | :-)   | UP    | neutron-linuxbridge-agent |
| e10466ac-63f7-4e5d-a982-5f94e3e2701c | Metadata agent     | controller1 | None              | :-)   | UP    | neutron-metadata-agent    |
| f88161bc-12bc-40b1-8337-a1f55e8679b6 | Linux bridge agent | controller1 | None              | :-)   | UP    | neutron-linuxbridge-agent |
+--------------------------------------+--------------------+-------------+-------------------+-------+-------+---------------------------+
```

## 3. Ceph

### 3.1 cephadm

Cephadm使用容器和systemd安装并管理Ceph集群，并与CLI和仪表板GUI紧密集成。

- cephadm仅支持Octopus和更高版本。
- cephadm与新的业务流程API完全集成，并完全支持新的CLI和仪表板功能来管理集群部署。
- cephadm需要容器支持（podman或docker）和Python 3。

>cephadm部署和管理Ceph集群。它是通过SSH将管理器守护程序连接到主机来实现的。管理器守护程序能够添加，删除和更新Ceph容器。
cephadm不依赖于Ansible，Rook和Salt等外部配置工具。

>cephadm管理Ceph集群的整个生命周期。此生命周期从引导过程开始，当cephadm在单个节点上创建一个微小的Ceph群集时。该群集由一台监视器和一台管理器组成。
cephadm然后使用业务流程界面（“第2天”命令）扩展集群，添加所有主机并配置所有Ceph守护程序和服务。可以通过Ceph命令行界面（CLI）或通过仪表板（GUI）来执行此生命周期的管理。

>cephadm是Ceph v15.2.0（Octopus）版本中的新增功能，并且不支持Ceph的旧版本。

### 3.2 部署ceph集群

#### 3.2.1 部署环境

- 内核版本：3.10.0-1127.el7.x86_64
- 操作系统：CentOS Linux release 7.8.2003 (Core)

节点列表，每个节点都有一块额外盘/dev/vdb
```
172.16.80.45 ceph-1 [ceph-admin,ceph-mon,ceph-mgr,ceph-osd]
172.16.80.185 ceph-2 [ceph-mon,ceph-mgr,ceph-osd]
172.16.80.213 ceph-3 [ceph-mon,ceph-mgr,ceph-osd]
172.16.80.203 ceph-4 [ceph-osd]
172.16.80.90 ceph-5  [ceph-osd]
```

#### 3.2.2 前提条件

每个节点都需要做的前置条件

1、安装python3环境
```
# yum install y wget -zlib-devel \
    bzip2-devel \
    openssl-devel \
    ncurses-devel \
    sqlite-devel \
    readline-devel \
    tk-devel \
    gcc \
    make

# wget -c https://www.python.org/ftp/python/3.9.5/Python-3.9.5.tar.xz
# tar -xvJf  Python-3.9.5.tar.xz
# ./configure prefix=/usr/local/Python3
# make && make install

# ln -s /usr/local/Python3/bin/python3 /usr/bin/python3
# ln -s /usr/local/Python3/bin/pip3 /usr/bin/pip3
```

2、安装docker
```
# yum-config-manager --add-repo \
    https://download.docker.com/linux/centos/docker-ce.repo

# yum install -y docker-ce
# systemctl enable docker
# systemctl start docker
```

3、安装chrony
4、安装systemd
5、安装lvm2

#### 3.2.3 安装cephadm

ceph-admin节点上执行
```
[root@ceph-1 ~]# curl --silent --remote-name --location https://github.com/ceph/ceph/raw/octopus/src/cephadm/cephadm
[root@ceph-1 ~]# chmod +x cephadm
[root@ceph-1 ~]# ./cephadm add-repo --release octopus
[root@ceph-1 ~]# ./cephadm install

[root@ceph-1 ~]# which cephadm
/usr/sbin/cephadm
```

#### 3.2.4 初始化新集群

```
[root@ceph-1 ~]# cephadm bootstrap --mon-ip 172.16.80.45
Verifying podman|docker is present...
Verifying lvm2 is present...
Verifying time synchronization is in place...
Unit chronyd.service is enabled and running
Repeating the final host check...
podman|docker (/usr/bin/docker) is present
systemctl is present
lvcreate is present
Unit chronyd.service is enabled and running
Host looks OK
Cluster fsid: 789b1ff2-b910-11eb-a538-fa163e24ae71
Verifying IP 172.16.80.45 port 3300 ...
Verifying IP 172.16.80.45 port 6789 ...
Mon IP 172.16.80.45 is in CIDR network 172.16.80.0/24
Pulling container image docker.io/ceph/ceph:v15...
Extracting ceph user uid/gid from container image...
Creating initial keys...
Creating initial monmap...
Creating mon...
Waiting for mon to start...
Waiting for mon...
mon is available
Assimilating anything we can from ceph.conf...
Generating new minimal ceph.conf...
Restarting the monitor...
Setting mon public_network...
Creating mgr...
Verifying port 9283 ...
Wrote keyring to /etc/ceph/ceph.client.admin.keyring
Wrote config to /etc/ceph/ceph.conf
Waiting for mgr to start...
Waiting for mgr...
mgr not available, waiting (1/10)...
mgr not available, waiting (2/10)...
mgr not available, waiting (3/10)...
mgr not available, waiting (4/10)...
mgr is available
Enabling cephadm module...
Waiting for the mgr to restart...
Waiting for Mgr epoch 5...
Mgr epoch 5 is available
Setting orchestrator backend to cephadm...
Generating ssh key...
Wrote public SSH key to to /etc/ceph/ceph.pub
Adding key to root@localhost's authorized_keys...
Adding host ceph-1...
Deploying mon service with default placement...
Deploying mgr service with default placement...
Deploying crash service with default placement...
Enabling mgr prometheus module...
Deploying prometheus service with default placement...
Deploying grafana service with default placement...
Deploying node-exporter service with default placement...
Deploying alertmanager service with default placement...
Enabling the dashboard module...
Waiting for the mgr to restart...
Waiting for Mgr epoch 13...
Mgr epoch 13 is available
Generating a dashboard self-signed certificate...
Creating initial admin user...
Fetching dashboard port number...
Ceph Dashboard is now available at:

	     URL: https://ceph-1:8443/
	    User: admin
	Password: 85ermr0hjd

You can access the Ceph CLI with:

	sudo /usr/sbin/cephadm shell --fsid 789b1ff2-b910-11eb-a538-fa163e24ae71 -c /etc/ceph/ceph.conf -k /etc/ceph/ceph.client.admin.keyring

Please consider enabling telemetry to help improve Ceph:

	ceph telemetry on

For more information see:

	https://docs.ceph.com/docs/master/mgr/telemetry/

Bootstrap complete.
```
浏览器登录`https://ceph-1:8443/`，首次登录会提示修改密码

查看所有组件运行状态
```
[root@ceph-1 ~]# ceph orch ps
NAME                  HOST    STATUS         REFRESHED  AGE  VERSION  IMAGE NAME                            IMAGE ID      CONTAINER ID
alertmanager.ceph-1   ceph-1  running (8s)   5s ago     19s  0.20.0   docker.io/prom/alertmanager:v0.20.0   0881eb8f169f  fb2ba2adee1d
crash.ceph-1          ceph-1  running (17s)  5s ago     18s  15.2.12  docker.io/ceph/ceph:v15               c717e215da21  f32945a238d8
grafana.ceph-1        ceph-1  running (7s)   5s ago     16s  6.7.4    docker.io/ceph/ceph-grafana:6.7.4     ae5c36c3d3cd  6606b21f0d06
mgr.ceph-1.qvbenz     ceph-1  running (68s)  5s ago     68s  15.2.12  docker.io/ceph/ceph:v15               c717e215da21  1f7835d9a3f8
mon.ceph-1            ceph-1  running (68s)  5s ago     71s  15.2.12  docker.io/ceph/ceph:v15               c717e215da21  200e7545429b
node-exporter.ceph-1  ceph-1  running (15s)  5s ago     15s  0.18.1   docker.io/prom/node-exporter:v0.18.1  e5a616e4b9cf  7f728ef3eb9b
prometheus.ceph-1     ceph-1  running (14s)  5s ago     14s  2.18.1   docker.io/prom/prometheus:v2.18.1     de242295e225  313e5790bad6
```

#### 3.2.5 启用ceph cli

ceph shell会进入装好ceph软件包的容器中, 设置个alias，方便使用
```
[root@ceph-1 ~]# ./cephadm shell -- ceph status

[root@ceph-1 ~]# vim /etc/bashrc
alias ceph='cephadm shell -- ceph'
```

也可以在宿主机上安装ceph-common(可选)
```
[root@ceph-1 ~]# cephadm add-repo --release octopus
[root@ceph-1 ~]# cephadm install ceph-common
```

#### 3.2.6 注册节点

把第一个mon节点上产生的ssh公钥拷贝到新节点上
```
[root@ceph-1 ~]# ssh-copy-id -f -i /etc/ceph/ceph.pub root@172.16.80.185
[root@ceph-1 ~]# ssh-copy-id -f -i /etc/ceph/ceph.pub root@172.16.80.213
```

注册新节点, 会自动扩展成monitor和manager
```
[root@ceph-1 ~]# ceph orch host add  ceph-2
[root@ceph-1 ~]# ceph orch host add  ceph-3
```

查看ceph纳管的所有节点
```
[root@ceph-1 ~]# ceph orch host ls
HOST    ADDR    LABELS  STATUS
ceph-1  ceph-1
ceph-2  ceph-2
ceph-3  ceph-3
```

移除注册节点
```
# ceph orch host rm <host>
```

#### 3.2.7 部署mon(可选)

上述注册节点的步骤会自动部署mon，所以以下步骤可跳过。

一个典型的ceph集群一般有3个或5个monitor进程，如果集群规模达到5个节点及以上的话，建议部署5个monitor进程

设置ceph public_network网络
```
# ceph config set mon public_network *<mon-cidr-network>*
```

默认情况下，向群集中添加新主机时，cephadm会自动最多添加5个mon, 可修改默认mon数量
```
[root@ceph-1 ~]# ceph orch apply mon 3
Scheduled mon update...
```

部署mon到指定的节点上
```
[root@ceph-1 ~]# ceph orch apply mon *<host1,host2,host3,...>*
```

禁止自动部署mon
```
# ceph orch apply mon --unmanaged
```

#### 3.2.8 部署osd

再注册两个节点
```
[root@ceph-1 ~]# ssh-copy-id -f -i /etc/ceph/ceph.pub root@172.16.80.203
[root@ceph-1 ~]# ssh-copy-id -f -i /etc/ceph/ceph.pub root@172.16.80.90

[root@ceph-1 ~]# ceph orch host add  ceph-4
[root@ceph-1 ~]# ceph orch host add  ceph-5
```

自动添加所有可用设备(貌似没有效果，故手动指定添加osd)
```
[root@ceph-1 ~]# ceph orch apply osd --all-available-devices
```

指定节点指定设备创建osd
```
[root@ceph-1 ~]# ceph orch daemon add osd ceph-1:/dev/vdb
[root@ceph-1 ~]# ceph orch daemon add osd ceph-2:/dev/vdb
[root@ceph-1 ~]# ceph orch daemon add osd ceph-3:/dev/vdb
[root@ceph-1 ~]# ceph orch daemon add osd ceph-4:/dev/vdb
[root@ceph-1 ~]# ceph orch daemon add osd ceph-5:/dev/vdb
```

显示集群主机上所有的存储设备清单
```
[root@ceph-1 ~]# ceph orch device ls
Hostname  Path      Type  Serial                Size   Health   Ident  Fault  Available
ceph-1    /dev/vdb  hdd   d190d163-ff43-4e8b-8  21.4G  Unknown  N/A    N/A    No
ceph-2    /dev/vdb  hdd   6541642c-a7c0-46e4-9  21.4G  Unknown  N/A    N/A    No
ceph-3    /dev/vdb  hdd   67db6403-5d8d-417f-8  21.4G  Unknown  N/A    N/A    No
ceph-4    /dev/vdb  hdd   931038cb-7a6e-4317-b  21.4G  Unknown  N/A    N/A    No
ceph-5    /dev/vdb  hdd   0a25d009-f18f-49ba-9  21.4G  Unknown  N/A    N/A    No
```

查看osd pool列表，默认有一个device_health_metrics的pool
```
[root@ceph-1 ~]# ceph osd pool ls detail
pool 1 'device_health_metrics' replicated size 3 min_size 2 crush_rule 0 object_hash rjenkins pg_num 1 pgp_num 1 autoscale_mode on last_change 12 flags hashpspool stripe_width 0 pg_num_min 1 application mgr_devicehealth
```

验证块存储rbd挂载
```
#1.创建一个test的pool
[root@ceph-1 ~]# ceph osd pool create test 64 64
pool 'test' created

#2.创建块设备test1,容量为1G
[root@ceph-1 ~]# rbd create test/test1 --size 1024

#3.查看块设备test1详情
[root@ceph-1 ~]# rbd info test/test1
rbd image 'test1':
	size 1 GiB in 256 objects
	order 22 (4 MiB objects)
	snapshot_count: 0
	id: 3a209142feac
	block_name_prefix: rbd_data.3a209142feac
	format: 2
	features: layering, exclusive-lock, object-map, fast-diff, deep-flatten
	op_features:
	flags:
	create_timestamp: Fri May 21 02:15:19 2021
	access_timestamp: Fri May 21 02:15:19 2021
	modify_timestamp: Fri May 21 02:15:19 2021

#4.映射块设备test1，默认内核不支持rbd一些特性
[root@ceph-1 ~]# rbd map test/test1
rbd: sysfs write failed
RBD image feature set mismatch. You can disable features unsupported by the kernel with "rbd feature disable test/test1 object-map fast-diff deep-flatten".
In some cases useful info is found in syslog - try "dmesg | tail".
rbd: map failed: (6) No such device or address

[root@ceph-1 ~]# rbd feature disable test/test1 object-map fast-diff deep-flatten

[root@ceph-1 ~]# rbd map test/test1
/dev/rbd0

#5.格式化并挂载
[root@ceph-1 ~]# mkfs.xfs /dev/rbd0
meta-data=/dev/rbd0              isize=512    agcount=8, agsize=32768 blks
         =                       sectsz=512   attr=2, projid32bit=1
         =                       crc=1        finobt=0, sparse=0
data     =                       bsize=4096   blocks=262144, imaxpct=25
         =                       sunit=1024   swidth=1024 blks
naming   =version 2              bsize=4096   ascii-ci=0 ftype=1
log      =internal log           bsize=4096   blocks=2560, version=2
         =                       sectsz=512   sunit=8 blks, lazy-count=1
realtime =none                   extsz=4096   blocks=0, rtextents=0
[root@ceph-1 ~]# mount /dev/rbd0 /mnt/

#6.测试读写
[root@ceph-1 ~]# echo "test" > /mnt/test
[root@ceph-1 ~]# cat /mnt/test
test

#7.清理环境
[root@ceph-1 ~]# umount /mnt/
[root@ceph-1 ~]# rbd unmap test/test1
[root@ceph-1 ~]# rbd rm test/test1
Removing image: 100% complete...done.
```

#### 3.2.9 部署mds

指定节点部署mds
```
[root@ceph-1 ~]# ceph orch apply mds cephfs --placement="3 ceph-1 ceph-2 ceph-3"
Scheduled mds.cephfs update...
```

cephfs需要两个存储池，一个存储文件，另一个存储文件的元数据
```
[root@ceph-1 ~]# ceph osd pool create cephfs_data 128 128
pool 'cephfs_data' created
[root@ceph-1 ~]# ceph osd pool create cephfs_metadata 128 128
pool 'cephfs_metadata' created
```

手动创建cephfs
```
[root@ceph-1 ~]# ceph fs new cephfs cephfs_metadata cephfs_data
new fs with metadata pool 4 and data pool 3
```

查看cephfs
```
[root@ceph-1 ~]# ceph fs ls
name: cephfs, metadata pool: cephfs_metadata, data pools: [cephfs_data ]
```

挂载cephfs
```
[root@ceph-3 ~]# mkdir -p /mnt/cephfs/
[root@ceph-3 ~]# mount -t ceph 172.16.80.45:/ /mnt/cephfs -o name=admin,secret=AQBrBKZgarHxAxAAQm2TL1KM3gkW7zr5A2yZgw==
[root@ceph-3 ~]# mount |grep cephfs
172.16.80.45:/ on /mnt/cephfs type ceph (rw,relatime,name=admin,secret=<hidden>,acl,wsize=16777216)
```

#### 3.2.10 部署rgws

cephadm将radosgw部署为管理特定领域和区域的守护程序的集合，创建rgw的realm、zonegroup、zone(--default设置默认值)
```
[root@ceph-1 ~]# radosgw-admin realm create --rgw-realm=testrgw --default
{
    "id": "359ff5f9-db95-493a-91d8-90c4b626c848",
    "name": "testrgw",
    "current_period": "a0c7dc86-9070-4ffc-affd-d8e953df6949",
    "epoch": 1
}

[root@ceph-1 ~]# radosgw-admin zonegroup create --rgw-zonegroup=testzone --master --default
{
    "id": "3029b614-c16a-4086-9db4-f1a2ba356c0b",
    "name": "testzone",
    "api_name": "testzone",
    "is_master": "true",
    "endpoints": [],
    "hostnames": [],
    "hostnames_s3website": [],
    "master_zone": "",
    "zones": [],
    "placement_targets": [],
    "default_placement": "",
    "realm_id": "359ff5f9-db95-493a-91d8-90c4b626c848",
    "sync_policy": {
        "groups": []
    }
}

[root@ceph-1 ~]# radosgw-admin zone create --rgw-zonegroup=testzone --rgw-zone=zone1 --master --default
{
    "id": "0f3caf93-05bc-49cd-8fd3-31fce9dbab48",
    "name": "zone1",
    "domain_root": "zone1.rgw.meta:root",
    "control_pool": "zone1.rgw.control",
    "gc_pool": "zone1.rgw.log:gc",
    "lc_pool": "zone1.rgw.log:lc",
    "log_pool": "zone1.rgw.log",
    "intent_log_pool": "zone1.rgw.log:intent",
    "usage_log_pool": "zone1.rgw.log:usage",
    "roles_pool": "zone1.rgw.meta:roles",
    "reshard_pool": "zone1.rgw.log:reshard",
    "user_keys_pool": "zone1.rgw.meta:users.keys",
    "user_email_pool": "zone1.rgw.meta:users.email",
    "user_swift_pool": "zone1.rgw.meta:users.swift",
    "user_uid_pool": "zone1.rgw.meta:users.uid",
    "otp_pool": "zone1.rgw.otp",
    "system_key": {
        "access_key": "",
        "secret_key": ""
    },
    "placement_pools": [
        {
            "key": "default-placement",
            "val": {
                "index_pool": "zone1.rgw.buckets.index",
                "storage_classes": {
                    "STANDARD": {
                        "data_pool": "zone1.rgw.buckets.data"
                    }
                },
                "data_extra_pool": "zone1.rgw.buckets.non-ec",
                "index_type": 0
            }
        }
    ],
    "realm_id": "359ff5f9-db95-493a-91d8-90c4b626c848"
}
```

指定节点创建rgw
```
# ceph orch apply rgw <realm_name> <zone_name> [<subcluster>] [<port: Update the number of RGW instances for the given zone int>] [--ssl] [<placement>] [--dry-run] [plain|json|json-pretty|yaml] [--unmanaged]
[root@ceph-1 ~]# ceph orch apply rgw testrgw mr-1 --placement="2 ceph-4 ceph-5"
Scheduled rgw.testrgw.mr-1 update...
```

配置ceph dashboard能够查看rgw集群信息，因为rgw有自己的一套账号体系，在rgw中创建一个dashboard的账号
```
[root@ceph-1 ~]# radosgw-admin user create --uid=rgw --display-name=rgw --system
{
    "user_id": "rgw",
    "display_name": "rgw",
    "email": "",
    "suspended": 0,
    "max_buckets": 1000,
    "subusers": [],
    "keys": [
        {
            "user": "rgw",
            "access_key": "45FW7W30MHJOH8633464",
            "secret_key": "DIvMiQl3AzllCSyEEn8TuoDFCKaHFt7QqGMXzqnU"
        }
    ],
    "swift_keys": [],
    "caps": [],
    "op_mask": "read, write, delete",
    "system": "true",
    "default_placement": "",
    "default_storage_class": "",
    "placement_tags": [],
    "bucket_quota": {
        "enabled": false,
        "check_on_raw": false,
        "max_size": -1,
        "max_size_kb": 0,
        "max_objects": -1
    },
    "user_quota": {
        "enabled": false,
        "check_on_raw": false,
        "max_size": -1,
        "max_size_kb": 0,
        "max_objects": -1
    },
    "temp_url_keys": [],
    "type": "rgw",
    "mfa_ids": []
}
```

```
[root@ceph-1 ~]# echo -n "45FW7W30MHJOH8633464" > file-containing-access-key
[root@ceph-1 ~]# echo -n "DIvMiQl3AzllCSyEEn8TuoDFCKaHFt7QqGMXzqnU" > file-containing-secret-key

[root@ceph-1 ~]# ceph dashboard set-rgw-api-access-key -i file-containing-access-key
Option RGW_API_ACCESS_KEY updated
[root@ceph-1 ~]# ceph dashboard set-rgw-api-secret-key -i file-containing-secret-key
Option RGW_API_SECRET_KEY updated
```
配置完后，ceph dashboard上就可以操作Object Gateway了

安装s3cmd命令行客户端
```
[root@ceph-3 ~]# yum install s3cmd -y
```

配置s3cmd（172.16.80.90:80是radosgw监听的地址端口）
```
[root@ceph-3 ~]# s3cmd --configure

Enter new values or accept defaults in brackets with Enter.
Refer to user manual for detailed description of all options.

Access key and Secret key are your identifiers for Amazon S3. Leave them empty for using the env variables.
Access Key: 45FW7W30MHJOH8633464
Secret Key: DIvMiQl3AzllCSyEEn8TuoDFCKaHFt7QqGMXzqnU
Default Region [US]:

Use "s3.amazonaws.com" for S3 Endpoint and not modify it to the target Amazon S3.
S3 Endpoint [s3.amazonaws.com]: 172.16.80.90:80

Use "%(bucket)s.s3.amazonaws.com" to the target Amazon S3. "%(bucket)s" and "%(location)s" vars can be used
if the target S3 system supports dns based buckets.
DNS-style bucket+hostname:port template for accessing a bucket [%(bucket)s.s3.amazonaws.com]: 172.16.80.90:80/%(bucket)s

Encryption password is used to protect your files from reading
by unauthorized persons while in transfer to S3
Encryption password:
Path to GPG program [/usr/bin/gpg]:

When using secure HTTPS protocol all communication with Amazon S3
servers is protected from 3rd party eavesdropping. This method is
slower than plain HTTP, and can only be proxied with Python 2.7 or newer
Use HTTPS protocol [Yes]: no

On some networks all internet access must go through a HTTP proxy.
Try setting it here if you can't connect to S3 directly
HTTP Proxy server name:

New settings:
  Access Key: 45FW7W30MHJOH8633464
  Secret Key: DIvMiQl3AzllCSyEEn8TuoDFCKaHFt7QqGMXzqnU
  Default Region: US
  S3 Endpoint: 172.16.80.90:80
  DNS-style bucket+hostname:port template for accessing a bucket: 172.16.80.90:80/%(bucket)s
  Encryption password:
  Path to GPG program: /usr/bin/gpg
  Use HTTPS protocol: False
  HTTP Proxy server name:
  HTTP Proxy server port: 0

Test access with supplied credentials? [Y/n] y
Please wait, attempting to list all buckets...
Success. Your access key and secret key worked fine :-)

Now verifying that encryption works...
Not configured. Never mind.

Save settings? [y/N] y
Configuration saved to '/root/.s3cfg'
```

启用signature_v2
```
# vim /root/.s3cfg
signature_v2 = True
```

验证rgw
```
#1.创建buckets
[root@ceph-3 ~]# s3cmd mb s3://test
Bucket 's3://test/' created

#2.查看buckets
[root@ceph-3 ~]# s3cmd ls
2021-05-21 12:19  s3://test

#3.上传文件到buckets
[root@ceph-3 ~]# s3cmd put /var/log/messages s3://test/messages
upload: '/var/log/messages' -> 's3://test/messages'  [part 1 of 3, 15MB] [1 of 1]
 15728640 of 15728640   100% in    2s     6.02 MB/s  done
upload: '/var/log/messages' -> 's3://test/messages'  [part 2 of 3, 15MB] [1 of 1]
 15728640 of 15728640   100% in    0s    28.72 MB/s  done
upload: '/var/log/messages' -> 's3://test/messages'  [part 3 of 3, 5MB] [1 of 1]
 5290039 of 5290039   100% in    0s    16.92 MB/s  done

#4. 上传目录到buckets
[root@ceph-3 ~]# s3cmd put /etc/yum.repos.d/ --recursive  --recursive s3://test/yum/
upload: '/etc/yum.repos.d/CentOS-Base.repo' -> 's3://test/yum/CentOS-Base.repo'  [1 of 11]
 1664 of 1664   100% in    0s    57.66 KB/s  done
upload: '/etc/yum.repos.d/CentOS-CR.repo' -> 's3://test/yum/CentOS-CR.repo'  [2 of 11]
 1309 of 1309   100% in    0s    22.59 KB/s  done
upload: '/etc/yum.repos.d/CentOS-Debuginfo.repo' -> 's3://test/yum/CentOS-Debuginfo.repo'  [3 of 11]
 649 of 649   100% in    0s    10.49 KB/s  done
upload: '/etc/yum.repos.d/CentOS-Media.repo' -> 's3://test/yum/CentOS-Media.repo'  [4 of 11]
 630 of 630   100% in    0s    10.95 KB/s  done
upload: '/etc/yum.repos.d/CentOS-Sources.repo' -> 's3://test/yum/CentOS-Sources.repo'  [5 of 11]
 1331 of 1331   100% in    0s    22.93 KB/s  done
upload: '/etc/yum.repos.d/CentOS-Vault.repo' -> 's3://test/yum/CentOS-Vault.repo'  [6 of 11]
 7577 of 7577   100% in    0s   461.08 KB/s  done
upload: '/etc/yum.repos.d/CentOS-fasttrack.repo' -> 's3://test/yum/CentOS-fasttrack.repo'  [7 of 11]
 314 of 314   100% in    0s     5.26 KB/s  done
upload: '/etc/yum.repos.d/CentOS-x86_64-kernel.repo' -> 's3://test/yum/CentOS-x86_64-kernel.repo'  [8 of 11]
 616 of 616   100% in    0s    10.64 KB/s  done
upload: '/etc/yum.repos.d/docker-ce.repo' -> 's3://test/yum/docker-ce.repo'  [9 of 11]
 1919 of 1919   100% in    0s   122.17 KB/s  done
upload: '/etc/yum.repos.d/epel-testing.repo' -> 's3://test/yum/epel-testing.repo'  [10 of 11]
 1050 of 1050   100% in    0s    18.65 KB/s  done
upload: '/etc/yum.repos.d/epel.repo' -> 's3://test/yum/epel.repo'  [11 of 11]
 951 of 951   100% in    0s    16.75 KB/s  done

#5.查看buckets中的文件
[root@ceph-3 ~]# s3cmd ls s3://test/
                          DIR  s3://test/yum/
2021-05-21 12:31     36747319  s3://test/messages

#6.下载文件
[root@ceph-3 ~]# s3cmd get s3://test/messages msg.bak
download: 's3://test/messages' -> 'msg.bak'  [1 of 1]
 36747319 of 36747319   100% in    0s   123.63 MB/s  done
WARNING: MD5 signatures do not match: computed=d8b57ce97cc383266c68c86abe25efe3, received=83622893dbb2a16958423e3d97c74269

#7.下载目录
[root@ceph-3 ~]# mkdir -p test
[root@ceph-3 ~]# s3cmd get --recursive s3://test/yum/ test/
download: 's3://test/yum/CentOS-Base.repo' -> 'test/CentOS-Base.repo'  [1 of 11]
 1664 of 1664   100% in    0s   215.95 KB/s  done
download: 's3://test/yum/CentOS-CR.repo' -> 'test/CentOS-CR.repo'  [2 of 11]
 1309 of 1309   100% in    0s    29.41 KB/s  done
download: 's3://test/yum/CentOS-Debuginfo.repo' -> 'test/CentOS-Debuginfo.repo'  [3 of 11]
 649 of 649   100% in    0s    14.67 KB/s  done
download: 's3://test/yum/CentOS-Media.repo' -> 'test/CentOS-Media.repo'  [4 of 11]
 630 of 630   100% in    0s    13.91 KB/s  done
download: 's3://test/yum/CentOS-Sources.repo' -> 'test/CentOS-Sources.repo'  [5 of 11]
 1331 of 1331   100% in    0s    29.97 KB/s  done
download: 's3://test/yum/CentOS-Vault.repo' -> 'test/CentOS-Vault.repo'  [6 of 11]
 7577 of 7577   100% in    0s   581.35 KB/s  done
download: 's3://test/yum/CentOS-fasttrack.repo' -> 'test/CentOS-fasttrack.repo'  [7 of 11]
 314 of 314   100% in    0s     7.01 KB/s  done
download: 's3://test/yum/CentOS-x86_64-kernel.repo' -> 'test/CentOS-x86_64-kernel.repo'  [8 of 11]
 616 of 616   100% in    0s    13.64 KB/s  done
download: 's3://test/yum/docker-ce.repo' -> 'test/docker-ce.repo'  [9 of 11]
 1919 of 1919   100% in    0s   150.19 KB/s  done
download: 's3://test/yum/epel-testing.repo' -> 'test/epel-testing.repo'  [10 of 11]
 1050 of 1050   100% in    0s    24.02 KB/s  done
download: 's3://test/yum/epel.repo' -> 'test/epel.repo'  [11 of 11]
 951 of 951   100% in    0s    21.62 KB/s  done

[root@ceph-3 ~]# ll test/
total 48
-rw-r--r--. 1 root root 1664 May 21 12:31 CentOS-Base.repo
-rw-r--r--. 1 root root 1309 May 21 12:31 CentOS-CR.repo
-rw-r--r--. 1 root root  649 May 21 12:31 CentOS-Debuginfo.repo
-rw-r--r--. 1 root root  314 May 21 12:31 CentOS-fasttrack.repo
-rw-r--r--. 1 root root  630 May 21 12:31 CentOS-Media.repo
-rw-r--r--. 1 root root 1331 May 21 12:31 CentOS-Sources.repo
-rw-r--r--. 1 root root 7577 May 21 12:31 CentOS-Vault.repo
-rw-r--r--. 1 root root  616 May 21 12:31 CentOS-x86_64-kernel.repo
-rw-r--r--. 1 root root 1919 May 21 12:31 docker-ce.repo
-rw-r--r--. 1 root root  951 May 21 12:31 epel.repo
-rw-r--r--. 1 root root 1050 May 21 12:31 epel-testing.repo

#8.bucket上传文件后自动新建一个mr-1.rgw.buckets.data的存储池
[root@ceph-1 ~]# ceph osd lspools
1 device_health_metrics
2 cinder
3 cephfs_data
4 cephfs_metadata
5 test
6 nfs-ganesha
7 .rgw.root
8 mr-1.rgw.log
9 mr-1.rgw.control
10 mr-1.rgw.meta
11 mr-1.rgw.buckets.index
12 mr-1.rgw.buckets.non-ec
13 mr-1.rgw.buckets.data

#9.查看mr-1.rgw.buckets.data存储池中的内容
[root@ceph-1 ~]# rados -p  mr-1.rgw.buckets.data ls
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2_yum/CentOS-Debuginfo.repo
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2_yum/CentOS-x86_64-kernel.repo
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2__shadow_messages.2~uulO03Jct94mKYXEd4oQs-8MLKQIPj4.3_1
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2__multipart_messages.2~uulO03Jct94mKYXEd4oQs-8MLKQIPj4.3
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2__multipart_messages.2~uulO03Jct94mKYXEd4oQs-8MLKQIPj4.1
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2__shadow_messages.2~uulO03Jct94mKYXEd4oQs-8MLKQIPj4.2_1
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2_yum/CentOS-CR.repo
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2_yum/CentOS-Base.repo
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2_yum/CentOS-Vault.repo
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2_yum/CentOS-fasttrack.repo
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2__shadow_messages.2~uulO03Jct94mKYXEd4oQs-8MLKQIPj4.1_3
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2__shadow_messages.2~uulO03Jct94mKYXEd4oQs-8MLKQIPj4.2_2
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2__shadow_messages.2~uulO03Jct94mKYXEd4oQs-8MLKQIPj4.1_1
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2__shadow_messages.2~uulO03Jct94mKYXEd4oQs-8MLKQIPj4.1_2
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2_messages
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2_yum/CentOS-Media.repo
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2__shadow_messages.2~uulO03Jct94mKYXEd4oQs-8MLKQIPj4.2_3
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2__multipart_messages.2~uulO03Jct94mKYXEd4oQs-8MLKQIPj4.2
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2_yum/docker-ce.repo
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2_yum/epel-testing.repo
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2_yum/CentOS-Sources.repo
492ef619-1d17-4cdd-a691-c8c11cf14fde.24617.2_yum/epel.repo

#10.删除bucket中的文件
[root@ceph-3 ~]# s3cmd rm s3://test/messages
delete: 's3://test/messages'

#11.删除bucket中的目录
[root@ceph-3 ~]# s3cmd rm --recursive s3://test/yum/
delete: 's3://test/yum/CentOS-Base.repo'
delete: 's3://test/yum/CentOS-CR.repo'
delete: 's3://test/yum/CentOS-Debuginfo.repo'
delete: 's3://test/yum/CentOS-Media.repo'
delete: 's3://test/yum/CentOS-Sources.repo'
delete: 's3://test/yum/CentOS-Vault.repo'
delete: 's3://test/yum/CentOS-fasttrack.repo'
delete: 's3://test/yum/CentOS-x86_64-kernel.repo'
delete: 's3://test/yum/docker-ce.repo'
delete: 's3://test/yum/epel-testing.repo'
delete: 's3://test/yum/epel.repo'

#12.删除bucket
[root@ceph-3 ~]# s3cmd rb s3://test
Bucket 's3://test/' removed
```

#### 3.2.11 部署nfs-ganesha

ceph推荐使用nfs-ganesha来提供nfs服务

创建nfs池
```
# ceph osd pool create nfs-ganesha 64 64
```

创建nfs-ganesha
```
[root@ceph-1 ~]# ceph orch apply nfs nfs nfs-ganesha nfs-ns --placement="3 ceph-1 ceph-2 ceph-3"
Scheduled nfs.nfs update...

#启动application，不然会有warning告警
[root@ceph-1 ~]# ceph osd pool application enable nfs-ganesha nfs
enabled application 'nfs' on pool 'nfs-ganesha'

[root@ceph-1 ~]# ceph dashboard set-ganesha-clusters-rados-pool-namespace nfs-ganesha/nfs-ns
Option GANESHA_CLUSTERS_RADOS_POOL_NAMESPACE updated
```

cephfs的nfs是基于cephfs提供，所以在cephfs中创建一个/nfs目录，作为nfs服务的根目录
```
#1. 确保已挂载cephfs至/mnt/cephfs目录前提下
[root@ceph-3 ~]# mkdir -p /mnt/cephfs/nfs
#2. 登录https://172.16.80.45:8443/#/nfs，界面上创建nfs export
#3. 挂载nfs
[root@ceph-5 ~]# mount -t nfs 172.16.80.45:/nfs /mnt/
```

## 云管

- https://github.com/platform9/openstack-omni 提供一套标准的API管理混合和多云环境

## 5. 参考链接

- [OpenStack Installation Guide](https://docs.openstack.org/install-guide/)
- [INSTALLING CEPH](https://docs.ceph.com/en/latest/install/)
- [cephadm部署ceph集群](https://blog.csdn.net/networken/article/details/106870859)
- [CentOS8使用cephadm部署和配置Ceph Octopus](https://blog.csdn.net/get_set/article/details/108092248)
- [跳出云管看云管](https://zhuanlan.zhihu.com/p/77897908)
