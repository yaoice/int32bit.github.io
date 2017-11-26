---
layout: post
title: Neutron lbaas代理https实践
subtitle: ""
catalog: true
tags:
     - OpenStack
---

## 背景

通过neutron-lbaas实现对https的代理，引用官方的解释 [https://docs.openstack.org/mitaka/networking-guide/config-lbaas.html](https://docs.openstack.org/mitaka/networking-guide/config-lbaas.html)，neutron-lbaas是OpenStack负载均衡服务的实现，有lbaas v1和lbaas v2两种实现，其中v1是在Juno版本引入，在Liberty版本被弃用；v2是在Kilo版本引入；v1和v2无法兼容，两种实现都使用agent。agent处理HAProxy配置并管理HAProxy守护进程。另一种基于LBaaS v2的实现是Octavia项目，具有独立的API和独立的工作进程，在nova创建的虚拟机中创建负载均衡器。对于Octavia，不再需要agent。


### 测试环境

CentOS 7.1 （OpenStack Kilo）

Neutron lbaas v2（Kilo）

Barbican（Kilo）

### 概念介绍

lbaas有一些名字概念，引用官方的解释，它们分别是：

- Load balancer
  负载均衡器会占用一个子网的端口和ip.

- Listener
  负载平衡器可以监听多个端口上的请求。每一个端口都由Listener来指定.

- pool
  池包含通过负载均衡器提供服务的成员列表.

- member
  成员是在负载均衡器后端真正提供服务的server。 每个成员由提供服务的IP地址和端口来指定.

- Health monitor
  成员可能会不时地掉线，健康监视器会将服务没有正常响应的成员转移出去。健康监视器与池相关联。

LBaaS v2通过不同的服务插件有多个实现。 两个最常见的实现使用代理或Octavia服务。 这两个实现都使用LBaaS v2 API。

LBaaS v2将listener的概念添加到负载均衡器，LBaaS v2允许在单个负载平衡器IP地址上配置多个listener。

用官方的一张图来看它们之间的关系
<img src="/img/posts/2017-11-19/1.png" width="1000" height="500" />

### 部署lbaas

这里只介绍lbaas v2后端为haproxy，代理https的方式.

#### 安装lbaas

  [root@con01 ~(keystone_admin)]# yum install -y openstack-neutron-lbaas haproxy

#### 配置lbaas v2


    [root@con01 ~(keystone_admin)]# egrep -v "^$|^#" /etc/neutron/lbaas_agent.ini
    [DEFAULT]
    interface_driver = neutron.agent.linux.interface.OVSInterfaceDriver
    device_driver = neutron_lbaas.drivers.haproxy.namespace_driver.HaproxyNSDriver
    #device_driver = neutron_lbaas.services.loadbalancer.drivers.haproxy.namespace_driver.HaproxyNSDriver # 默认值是这个，误导性太大
    [haproxy]
    user_group = haproxy

    [root@con01 ~(keystone_admin)]# egrep -v "^$|^#" /etc/neutron/neutron_lbaas.conf
    [DEFAULT]
    [quotas]
    [service_providers]
    service_provider=LOADBALANCERV2:Haproxy:neutron_lbaas.drivers.haproxy.plugin_driver.HaproxyOnHostPluginDriver:default
    [certificates]

    # 追加lbaas v2 plugin
    [root@con01 ~(keystone_admin)]# egrep -v "^$|^#" /etc/neutron/neutron.conf
    [DEFAULT]
    service_plugins = router,neutron_lbaas.services.loadbalancer.plugin.LoadBalancerPluginv2


#### 创建lbaas v2启动服务脚本

    [root@con01 ~(keystone_admin)]# egrep -v "^$|^#" /usr/lib/systemd/system/neutron-lbaasv2-agent.service
    [Unit]
    Description=OpenStack Neutron Load Balancing V2 as a Service Agent
    After=syslog.target network.target
    [Service]
    Type=simple
    User=neutron
    ExecStart=/usr/bin/neutron-lbaasv2-agent --config-file /etc/neutron/neutron.conf --config-file /etc/neutron/neutron_lbaas.conf --config-file /etc/neutron/lbaas_agent.ini --log-file /var/log/neutron/lbaasv2-agent.log
    PrivateTmp=false
    KillMode=process
    [Install]
    WantedBy=multi-user.target

#### 启动服务

    [root@con01 ~(keystone_admin)]# systemctl daemon-reload
    [root@con01 ~(keystone_admin)]# systemctl start neutron-lbaasv2-agent.service

    [root@con01 ~(keystone_admin)]# systemctl restart neutron-server.service

### lbaas https方式

lbaas v2支持TERMINATED_HTTPS和HTTPS，后端driver为haproxy的话，分别对应haproxy代理ssl的这两种模式：

1、haproxy本身提供ssl证书，以http访问后端realserver（lbaas TERMINATED_HTTPS）

  这种方式，haproxy需要支持ssl(从haproxy 1.5版本开始支持ssl)，对应的haproy配置如下：


      frontend https_frontend
      bind *:443 ssl crt /etc/ssl/certs/xxxx.pem
      mode http
      option httpclose
      option forwardfor
      reqadd X-Forwarded-Proto:\ https
      default_backend real_server

      backend real_server
      mode http
      balance roundrobin
      server s1 192.168.1.5:80
      server s2 192.168.1.6:80

上述方式还需要pem文件，pem是private key和certificate的合体；好在lbaas key管理后端backend支持barbican和local，这里只介绍barbican方式。

2、haproxy本身只提供代理，以https访问后端realserver，简称ssl透传（lbaas HTTPS）

  这种方式，haproxy支不支持ssl都没关系; 因为是tcp方式，所以后端realserver就获取不到报头X-Forwarded-*信息。对应的haproxy配置如下：


      frontend https_frontend
      bind *:443
      mode tcp
      default_backend real_server

      backend real_server
      mode tcp
      balance roundrobin
      server node01 192.168.1.5:443
      server node02 192.168.1.6:443


### 部署barbican

#### barbican安装

参考这篇文章 [https://github.com/cloudkeep/barbican/wiki/Barbican-Quick-Start-Guide](https://github.com/cloudkeep/barbican/wiki/Barbican-Quick-Start-Guide), 推荐使用virtualenv虚拟环境来安装barbican

    pip install virtualenv
    virtualenv barbican27
    source barbican27/bin/activate   # 进入虚拟环境；推出虚拟环境是deactivate

    git clone https://github.com/openstack/barbican.git ／opt
    git checkout kilo-eol
    cd barbican
    bin/barbican.sh install

与keystone集成、配置详情见devstack kilo barbican过程
[https://github.com/openstack/barbican/blob/kilo-eol/contrib/devstack/lib/barbican](https://github.com/openstack/barbican/blob/kilo-eol/contrib/devstack/lib/barbican)

#### barbican集成keystone

    keystone user-create --name=barbican --pass=barbican --tenant-id <services租户ID> --email=barbican@example.com
    keystone user-role-add  --tenant-id <services租户ID> --user-id <barbican用户ID> --role-id <admin角色ID>
    keystone service-create --name=barbican --type='key-manager' --description="Barbican Service"
    keystone endpoint-create --region NEW_Region \
        --service-id <barbican服务ID> \
        --publicurl "http://10.125.224.21:9311" \
        --adminurl "http://10.125.224.21:9312" \
        --internalurl "http://10.125.224.21:9311"

#### 创建barbican数据库

    create database barbican character set utf8;  # 进入mariadb，创建barbican数据库
    grant all privileges on barbican.* to barbican@'localhost' identified by 'barbican';
    grant all privileges on barbican.* to barbican@'%' identified by 'barbican';

#### 修改barbican配置

    export BARBICAN_CONF_DIR=/etc/barbican
    export BARBICAN_DIR=/opt/barbican

    mkdir -p $BARBICAN_CONF_DIR
    cp $BARBICAN_DIR/etc/barbican/barbican-api.conf $BARBICAN_CONF_DIR
    cp $BARBICAN_DIR/etc/barbican/barbican-api-paste.ini $BARBICAN_CONF_DIR
    cp $BARBICAN_DIR/etc/barbican/barbican-admin-paste.ini $BARBICAN_CONF_DIR
    cp -R $BARBICAN_DIR/etc/barbican/vassals $BARBICAN_CONF_DIR/
    cp $BARBICAN_DIR/etc/barbican/barbican-functional.conf $BARBICAN_CONF_DIR
    cp $BARBICAN_DIR/etc/barbican/policy.json $BARBICAN_CONF_DIR

    touch /var/log/barbican/api.log
    mkdir -p /var/lib/barbican/cache

    [root@con01 ~(keystone_admin)]# egrep -v "^$|^#" /etc/barbican/barbican-api.conf
    [DEFAULT]
    verbose = True
    debug = False
    bind_host = 0.0.0.0
    bind_port = 9311
    host_href = http://10.125.224.21:9311   # 根据节点ip修改
    log_file = /var/log/barbican/api.log    
    backlog = 4096
    max_allowed_secret_in_bytes = 10000
    max_allowed_request_size_in_bytes = 1000000
    sql_connection = mysql://barbican:barbican@con01/barbican?charset=utf8
    sql_idle_timeout = 3600
    default_limit_paging = 10
    max_limit_paging = 100
    workers = 1
    delayed_delete = False
    scrub_time = 43200
    scrubber_datadir = /var/lib/barbican/scrubber
    policy_file=/etc/barbican/policy.json
    policy_default_rule=default
    ampq_durable_queues = True
    rabbit_userid=guest
    rabbit_password=guest
    rabbit_ha_queues = True
    rabbit_port=5672
    rabbit_hosts=con01:5672   # 根据节点增加
    [queue]
    enable = False
    namespace = 'barbican'
    topic = 'barbican.workers'
    version = '1.1'
    server_name = 'barbican.queue'
    [retry_scheduler]
    initial_delay_seconds = 10.0
    periodic_interval_max_seconds = 10.0
    [keystone_notifications]
    enable = False
    control_exchange = 'openstack'
    topic = 'notifications'
    allow_requeue = False
    version = '1.0'
    thread_pool_size = 10
    [secrets]
    broker = rabbit://guest:guest@con01    # 视情况修改
    [secretstore]
    namespace = barbican.secretstore.plugin
    enabled_secretstore_plugins = store_crypto
    [crypto]
    namespace = barbican.crypto.plugin
    enabled_crypto_plugins = simple_crypto
    [simple_crypto_plugin]
    kek = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='
    [dogtag_plugin]
    pem_path = '/etc/barbican/kra_admin_cert.pem'
    dogtag_host = localhost
    dogtag_port = 8443
    nss_db_path = '/etc/barbican/alias'
    nss_db_path_ca = '/etc/barbican/alias-ca'
    nss_password = 'password123'
    simple_cmc_profile = 'caOtherCert'
    [p11_crypto_plugin]
    library_path = '/usr/lib/libCryptoki2_64.so'
    login = 'mypassword'
    mkek_label = 'an_mkek'
    mkek_length = 32
    hmac_label = 'my_hmac_label'
    [kmip_plugin]
    username = 'admin'
    password = 'password'
    host = localhost
    port = 5696
    keyfile = '/path/to/certs/cert.key'
    certfile = '/path/to/certs/cert.crt'
    ca_certs = '/path/to/certs/LocalCA.crt'
    [certificate]
    namespace = barbican.certificate.plugin
    enabled_certificate_plugins = simple_certificate
    [certificate_event]
    namespace = barbican.certificate.event.plugin
    enabled_certificate_event_plugins = simple_certificate

    [root@con01 ~(keystone_admin)]# vim $BARBICAN_CONF_DIR/vassals/barbican-api.ini
    [uwsgi]
    buffer-size = 65535  # 增加这个配置

    [root@con01 ~(keystone_admin)]# vim /etc/barbican/barbican-api-paste.ini # 修改为如下配置
    [pipeline:barbican_api]
    pipeline = keystone_authtoken context apiapp
    [filter:keystone_authtoken]
    paste.filter_factory = keystonemiddleware.auth_token:filter_factory
    auth_protocol = http
    auth_host = 10.125.224.21
    auth_port = 35357
    auth_uri = http://10.125.224.21:5000
    identity_uri = http://10.125.224.21:35357
    admin_tenant_name = services
    admin_user = barbican
    admin_password = barbican
    auth_version = v2
    signing_dir = /var/lib/barbican/cache

#### 启动barbican api

    [root@con01 ~(keystone_admin)]# source barbican27/bin/activate
    (barbican27) [root@con01 ~(keystone_admin)]# uwsgi --master --emperor /etc/barbican/vassals/

#### 更新barbicanclient

    git clone https://github.com/openstack/python-barbicanclient /opt/
    git checkout kilo-eol
    mv /usr/lib/python2.7/site-packages/{barbicanclient,barbicanclient.bak}
    cp -r /opt/python-barbicanclient/barbicanclient /usr/lib/python2.7/site-packages/

### 测试

创建https的负载均衡器来验证，参考官方wiki的这篇教程，很详细。
[https://wiki.openstack.org/wiki/Network/LBaaS/docs/how-to-create-tls-loadbalancer#Update_neutron_config](https://wiki.openstack.org/wiki/Network/LBaaS/docs/how-to-create-tls-loadbalancer#Update_neutron_config)

#### 创建认证串和key

    openssl genrsa -des3 -out ca.key 1024
    openssl req -new -x509 -days 3650 -key ca.key -out ca.crt  
    openssl x509  -in  ca.crt -out ca.pem
    openssl genrsa -des3 -out ca-int_encrypted.key 1024
    openssl rsa -in ca-int_encrypted.key -out ca-int.key
    openssl req -new -key ca-int.key -out ca-int.csr -subj "/CN=ca-int@acme.com"
    openssl x509 -req -days 3650 -in ca-int.csr -CA ca.crt -CAkey ca.key -set_serial 01 -out ca-int.crt
    openssl genrsa -des3 -out server_encrypted.key 1024
    openssl rsa -in server_encrypted.key -out server.key
    openssl req -new -key server.key -out server.csr -subj "/CN=server@acme.com"
    openssl x509 -req -days 3650 -in server.csr  -CA ca-int.crt -CAkey ca-int.key -set_serial 01 -out server.crt

#### 创建Barbican secrets和containers

    barbican secret store --payload-content-type='text/plain' \
                          --name='certificate' \
                          --payload="$(cat server.crt)"

    barbican secret store --payload-content-type='text/plain' \
                          --name='private_key' \
                          --payload="$(cat server.key)"

    barbican secret container create --name='tls_container' \
                                     --type='certificate' --secret="certificate=$(barbican secret list | awk '/ certificate / {print $2}')" \
                                     --secret="private_key=$(barbican secret list | awk '/ private_key / {print $2}')"


#### 创建实例和网络

- 创建两个实例，ip分别为10.10.10.20、10.10.10.21
- 创建一个私网的子网subet-net01

#### 创建loadbalancer

    neutron lbaas-loadbalancer-create --name lb1 subet-net01

#### 创建listener

    neutron lbaas-listener-create --loadbalancer lb1 \
              --protocol-port 443 \
              --protocol TERMINATED_HTTPS \
              --name listener1 \
              --default-tls-container=$(barbican secret container list | awk '/ tls_container / {print $2}')

#### 创建pool

    neutron lbaas-pool-create --name pool1 --protocol HTTP --listener listener1 --lb-algorithm ROUND_ROBIN

#### 创建members

    neutron lbaas-member-create --subnet subet-net01 \
          --address 10.10.10.20 \
          --protocol-port 80 pool1

    neutron lbaas-member-create --subnet subet-net01 \
          --address 10.10.10.21 \
          --protocol-port 80 pool1

#### 创建healthmonitor

    neutron lbaas-healthmonitor-create --type HTTP  \
            --delay 3 \
            --max-retries 3 \
            --timeout 3 \
            --pool <pool-id>

.pem文件默认会在形如这样的目录下：/var/lib/neutron/lbaas/v2/b2fa71b0-67ba-4e72-b206-fbc306c6d5dc/b6c834e0-5d37-457e-a669-17b683efb176/

#### 设置lbaas v2配额

    neutron quota-update --tenant-id TENANT_UUID --loadbalancer 25
    neutron quota-update --tenant-id TENANT_UUID --pool 50


### 代码调试

部分lbaas相关关键代码：

    neutron api入口：
    neutron_lbaas.services.loadbalancer.plugin.LoadBalancerPluginv2

    lbaas v2 agent入口:
    neutron_lbaas.drivers.haproxy.namespace_driver.HaproxyNSDriver


    /usr/lib/python2.7/site-packages/neutron_lbaas/drivers/haproxy/namespace_driver.py(203)create()
    199  	    def create(self, loadbalancer):
    200  	        namespace = get_ns_name(loadbalancer.id)
    201
    202  	        self._plug(namespace, loadbalancer.vip_port)    # 创建lbaas namespace
    203  ->	      self._spawn(loadbalancer)           		# 根据jinja模版生成haporxy配置文件，并在对应namespace中启动haproxy进程

### 参考链接

- [http://www.cnblogs.com/pmyewei/p/7376921.html](http://www.cnblogs.com/pmyewei/p/7376921.html)
- [https://www.cnblogs.com/zhanmeiliang/p/6232245.html](https://www.cnblogs.com/zhanmeiliang/p/6232245.html)
- [https://chapter60.wordpress.com/2015/04/14/sample-scripts-to-automatically-set-up-lbaas-v2-loadbalancers-in-devstack/
](https://chapter60.wordpress.com/2015/04/14/sample-scripts-to-automatically-set-up-lbaas-v2-loadbalancers-in-devstack/
)
