---
layout: post
title: k8s大规模测试
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

Kylin 4.0.2(仿ubuntu系统)
Kubernetes: v1.14.6

### 准备
#### NTP

预装chrony，/etc/rc.local中使用ntpdate同步ntp server

#### sysctl调参

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

#### ulimit 

修改ulimit
```
vim /etc/security/limits.conf
*       hard nofile 65535000
*       soft nofile 65535000
*       hard nproc  65535000
*       soft nproc 65535000
```

### 测试
#### 批量创建节点

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

#### shell脚本

批量并发ping测试
```
# vim shell_ping.sh
#!/usr/bin/env sh

for i in `cat hostip.txt2`
do
ping -c 4 $i|grep -q 'ttl=' && echo "$i ok" || echo "$i failed" &
done
wait
echo "END"
```

#### Ansible脚本

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

inventory
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

playbook
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

runc/kubelet替换，使用禁用kmem的runc/kubelet版本
```
ansible -f 100 -i test.inventory deploy -m service -a "name=kubelet state=stopped"
ansible -f 100 -i test.inventory deploy -m service -a "name=docker state=stopped"
ansible -f 100 -i test.inventory deploy -m copy -a "src=runc dest=/usr/bin/runc mode=0777"
ansible -f 100 -i test.inventory deploy -m copy -a "src=kubelet dest=/usr/bin/kubelet mode=0777"
ansible -f 100 -i test.inventory deploy -m service -a "name=docker state=started"
ansible -f 100 -i test.inventory deploy -m service -a "name=kubelet state=started"
```

kubelet预留内存
```
[root@openstack-con01 test]# cat files/kubelet
KUBELET_EXTRA_ARGS=--system-reserved=cpu=2,memory=3Gi
```

```
ansible -f 100 -i test.inventory deploy -m copy -a "src=sysconfig_kubelet dest=/etc/sysconfig/kubelet"
ansible -f 100 -i test.inventory deploy -m service -a "name=kubelet state=restarted"
```

### 优化

#### etcd优化

1. etcd数据盘使用ssd
2. 磁盘IO优先级`ionice -c2 -n0 -p $(pgrep etcd)`
3. 网络延迟, 使用tc对流量进行优先级排序
```
$ tc qdisc add dev eth0 root handle 1: prio bands 3
$ tc filter add dev eth0 parent 1: protocol ip prio 1 u32 match ip sport 2380 0xffff flowid 1:1
$ tc filter add dev eth0 parent 1: protocol ip prio 1 u32 match ip dport 2380 0xffff flowid 1:1
$ tc filter add dev eth0 parent 1: protocol ip prio 2 u32 match ip sport 2379 0xffff flowid 1:1
$ tc filter add dev eth0 parent 1: protocol ip prio 2 u32 match ip dport 2379 0xffff flowid 1:1
```
4. k8s event使用单独的etcd
```
# kube-apiserver
--etcd-servers="http://etcd1:2379,http://etcd2:2379,http://etcd3:2379" --etcd-servers-overrides="/events#http://etcd11:2379,http://etcd12:2379,http://etcd13:2379"
```
也可以将 pod、node 等 object 也分离在单独的 etcd 实例中

5. 修改存储配额

    默认 ETCD 空间配额大小为 2G，超过 2G 将不再写入数据。通过给 ETCD 配置`--quota-backend-bytes`参数增大空间配额，最大支持8G


如果apiserver无响应，etcd容器异常退出，尝试etcd切换为http连接
```
# cat /etc/kubernetes/manifests/etcd.yaml 
apiVersion: v1
kind: Pod
metadata:
  labels:
    component: etcd
    tier: control-plane
  name: etcd
  namespace: kube-system
spec:
  containers:
  - command:
    - etcd
    - --advertise-client-urls=http://xxx:2379
    - --data-dir=/data_etcd
    - --initial-advertise-peer-urls=http://xxx:2380
    - --initial-cluster=xxx=http://xxx:2380
    - --listen-client-urls=http://0.0.0.0:2379
    - --listen-peer-urls=http://xxx:2380
    - --name=xxx
    - --snapshot-count=10000
    - --log-level=debug
    - --quota-backend-bytes=5368709120
    - --heartbeat-interval=10000 
    - --election-timeout=50000
```

```
# cat /etc/kubernetes/manifests/kube-apiserver.yaml 
spec:
  containers:
  - command:
    - kube-apiserver
    - --max-mutating-requests-inflight=3000
    - --max-requests-inflight=1000
    - --advertise-address=xxx
    - --allow-privileged=true
    - --authorization-mode=Node,RBAC
    - --client-ca-file=/etc/kubernetes/pki/ca.crt
    - --enable-admission-plugins=NodeRestriction
    - --enable-bootstrap-token-auth=true
    - --etcd-servers=http://xxx:2379
    - --insecure-port=0
```

#### kube-apiserver优化

- --max-mutating-requests-inflight ：在给定时间内的最大 mutating 请求数，调整 apiserver 的流控 qos，
可以调整至 3000，默认为 200
- --max-requests-inflight：在给定时间内的最大 non-mutating 请求数，默认 400，可以调整至 1000
- --watch-cache-sizes：调大 resources 的 watch size，默认为 100，当集群中 node 以及 pod 数量非常多时可以稍微调大，
比如： --watch-cache-sizes=node#1000,pod#5000

#### kube-controller-manager优化

- --kube-api-qps 值：可以调整至 100，默认值为 20
- --kube-api-burst 值：可以调整至 100，默认值为 30

#### kube-scheduler优化

- --kube-api-qps 值：可以调整至 100，默认值为 50

#### kube-proxy优化

使用ipvs模式，ipvs底层采用hash表，iptables底层是链表；iptables模式大量规则下增加/删除一条规则都非常耗时

#### kubelet优化

--feature-gates启用功能

1. 使用 node lease 减少心跳上报频率

    使用nodeLease对象(0.1 KB)更新请求替换老的Update Node Status 方式，这会大大减轻 apiserver的负担
    
    版本要求:
    
    | 特性    | 默认值   |  状态  |  开始 | 结束
    | :---:  | :---:  | :---:  | :---:  | :---:  |
    | NodeLease    | false    |   Alpha      | 1.12 |  1.13|
    | NodeLease    |   true   |   Beta    |  1.14 |  1.16|
    | NodeLease    |   true   |  GA  |  1.17| - |

2. 使用WatchBookmark机制

    kubernetes v1.15支持bookmark机制，bookmark主要作用是只将特定的事件发送给客户端，从而避免增加apiserver的负载。

    版本要求:
   
    | 特性    | 默认值   |  状态  |  开始 | 结束
    | :---:  | :---:  | :---:  | :---:  | :---:  |
    | WatchBookmark   | false    |   Alpha      | 1.15 |  1.15|
    | WatchBookmark   |   true   |   Beta    |  1.16 |  1.16|
    | WatchBookmark   |   true   |  GA  |  1.17| - |

### 参考链接

- [https://www.cnblogs.com/xieshengsen/p/6932337.html](https://www.cnblogs.com/xieshengsen/p/6932337.html)
- [https://zhuanlan.zhihu.com/p/111244925](https://zhuanlan.zhihu.com/p/111244925)
- [https://blog.tianfeiyu.com/2019/10/08/etcd_improvements/](https://blog.tianfeiyu.com/2019/10/08/etcd_improvements/)
