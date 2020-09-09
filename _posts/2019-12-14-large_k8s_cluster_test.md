---
layout: post
title: k8s大规模测试准备
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

Kylin 4.0.2(仿ubuntu系统)

### NTP 

预装chrony，/etc/rc.local中使用ntpdate同步ntp server

### sysctl调参

sysctl.conf加固
```
# vim /etc/sysctl.conf
kernel.core_pattern = /tmp/core-%p-%e-%t
# 网桥iptables FORWARD生效
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
# 开启 IP 转发
net.ipv4.ip_forward = 1
# 允许非本地址绑定
net.ipv4.ip_nonlocal_bind=1
# 增大socket监听队列大小
net.core.somaxconn = 655350
# 启用SYN Cookies
net.ipv4.tcp_syncookies = 1
# 增大半连接的最大数量
net.ipv4.tcp_max_syn_backlog = 16384
# 在NAT环境下不启用
net.ipv4.tcp_tw_recycle = 0
# 启用时间戳
net.ipv4.tcp_timestamps=1
# 允许TIME_WAIT占用的端口可以重复利用
net.ipv4.tcp_tw_reuse = 1
# 缩短处于TIME_WAIT状态的超时时间
net.ipv4.tcp_fin_timeout = 30
# 增大处于TIME_WAIT状态的连接数量
net.ipv4.tcp_max_tw_buckets = 5000
# 增大最大连接跟踪数
net.netfilter.nf_conntrack_max = 2097152
# 缩短连接跟踪表中处于TIME_WAIT状态连接的超时时间
net.netfilter.nf_conntrack_tcp_timeout_time_wait = 30
# 增大系统的最大文件描述符数
fs.file-max=65535000
# 增加进程的最大文件描述符的数量
fs.nr_open=65535000
```

### ulimit 

修改ulimit
```
vim /etc/security/limits.conf
*       hard nofile 65535000
*       soft nofile 65535000
*       hard nproc  65535000
*       soft nproc 65535000
```

### 批量创建节点

```
root@Kylin:~# cat auto_add_server.sh 
#!/usr/bin/env sh

iplist=`cat /home/ip.list`
for ip in ${iplist[*]}; do
echo ${ip}
curl -X POST \
  http://<cluster-api>.com/apis/v1/pools/demo_demo/servers \
  -H 'Content-Type: application/json' \
  -H 'cache-control: no-cache' \
  -d '{
    "ip": "'"${ip}"'",
    "kernel": "4.14.0-115.el7a.0.1.aarch64",
    "networkInfo": {
        "api_interface": "eth0"
    },
    "sshInfo": {
        "sshPass": "xxxxxx",
        "sshPort": 22,
        "sshUser": "root"
    }
}'
done
```

### Ansible脚本

```
[root@openstack-con01 test]# tree
.
|-- ansible.cfg
|-- files
|   |-- runc
|   |-- kubelet
|   `-- sysconfig_kubelet
|-- test.inventory
`-- test.yml

1 directory, 5 files
```

#### inventory

```
[root@openstack-con01 test(keystone_admin)]# cat test.inventory
[deploy]
12.18.55.14 ansible_user=root ansible_ssh_pass=xxx ansible_ssh_port=22
12.168.55.15 ansible_user=root ansible_ssh_pass=xxx ansible_ssh_port=22
12.168.55.17 ansible_user=root ansible_ssh_pass=xxx ansible_ssh_port=22
12.168.72.10
。。。。。。

[deploy:vars]
ansible_user=root
ansible_ssh_pass=xxxxxx
ansible_ssh_port=22
```

#### playbook

```
[root@openstack-con01 test(keystone_admin)]# cat test.yml
---

- hosts: deploy
  gather_facts: false
  tasks:
  - name: sed replace sshd
    shell: "sed -i 's/#UseDNS yes/UseDNS no/g' /etc/ssh/sshd_config"
    ignore_errors: true

- hosts: deploy
  gather_facts: false
  tasks:
  - name: restart sshd
    shell: "service sshd reload"

- hosts: deploy
  gather_facts: false
  tasks:
  - name: timezone
    shell: "cp -rf  /usr/share/zoneinfo/Asia/Shanghai /etc/"

- hosts: deploy
  gather_facts: false
  tasks:
  - name: disable selinux
    shell: "sed -i 's/SELINUX=enforcing/SELINUX=disabled/g' /etc/selinux/config"
    ignore_errors: true

- hosts: deploy
  gather_facts: false
  tasks:
  - name: dd selinux
    shell: "setenforce 0 && modprobe ip_conntrack && modprobe br_netfilter"

- hosts: deploy
  gather_facts: false
  tasks:
  - name: Setting sysctl values
    sysctl: name={{ item.name }} value={{ item.value }} sysctl_set=yes
    with_items:
     - { name: "net.ipv4.ip_forward", value: 1}
     - { name: "net.bridge.bridge-nf-call-iptables", value: 1}
     - { name: "net.bridge.bridge-nf-call-ip6tables", value: 1}
     - { name: "net.ipv4.tcp_max_syn_backlog", value: 16384}
```

```
ansible-playbook -vvv -vv -i test/test.inventory test.yml
```

#### runc/kubelet替换

使用禁用kmem的runc/kubelet版本

```
ansible -f 100 -i test.inventory deploy -m service -a "name=kubelet state=stopped"
ansible -f 100 -i test.inventory deploy -m service -a "name=docker state=stopped"
ansible -f 100 -i test.inventory deploy -m copy -a "src=runc dest=/usr/bin/runc mode=0777"
ansible -f 100 -i test.inventory deploy -m copy -a "src=kubelet dest=/usr/bin/kubelet mode=0777"
ansible -f 100 -i test.inventory deploy -m service -a "name=docker state=started"
ansible -f 100 -i test.inventory deploy -m service -a "name=kubelet state=started"
```

#### kubelet预留内存

```
[root@openstack-con01 test]# cat files/kubelet
KUBELET_EXTRA_ARGS=--system-reserved=cpu=2,memory=3Gi
```

```
ansible -f 100 -i test.inventory deploy -m copy -a "src=sysconfig_kubelet dest=/etc/sysconfig/kubelet"
ansible -f 100 -i test.inventory deploy -m service -a "name=kubelet state=restarted"
```