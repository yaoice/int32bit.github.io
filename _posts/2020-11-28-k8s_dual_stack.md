---
layout: post
title: k8s ipv4/ipv6双栈实践
subtitle: ""
catalog: true
tags:
     - k8s
---

### 1 k8s双栈

k8s从1.16版本支持ipv4/ipv6双协议栈，集群将支持同时分配IPv4和IPv6地址

### 2 ipv6

#### 2.1 简介

>IPv6具有比IPv4大得多的编码地址空间。这是因为IPv6采用128位的地址，而IPv4使用的是32位。因此新增的地址空间支持2128（约3.4×1038）个地址，具体数量为340,282,366,920,938,463,463,374,607,431,768,211,456 个，也可以说成1632个，因为每4位地址（128位分为32段，每段4位）可以取24=16个不同的值。
网络地址转换是目前减缓IPv4地址耗尽最有效的方式，而IPv6的地址消除了对它的依赖，被认为足够在可以预测的未来使用。就以地球人口70亿人计算，每人平均可分得约4.86×1028（486117667×1020）个IPv6地址。
IPv6从IPv4到IPv6最显著的变化就是网络地址的长度。RFC 2373和RFC 2374定义的IPv6地址有128位长；IPv6地址的表达形式一般采用32个十六进制数。
在很多场合，IPv6地址由两个逻辑部分组成：一个64位的网络前缀和一个64位的主机地址，主机地址通常根据物理地址自动生成，叫做EUI-64（或者64-位扩展唯一标识）

#### 2.3 地址分类

1. 单播（unicast）地址
    
   >单播地址标示一个网络接口。协议会把送往地址的数据包送往给其接口。IPv6的单播地址可以有一个代表特殊地址名字的范畴，如链路本地地址（link local address）和唯一区域地址（ULA，unique local address）。
    单播地址包括可聚类的全球单播地址、链路本地地址等。

2. 任播（anycast）地址

   >任播像是Unicast（单点传播）与Broadcast（多点广播）的综合。单点广播在来源和目的地间直接进行通信；多点广播存在于单一来源和多个目的地进行通信。
    而Anycast则在以上两者之间，它像多点广播（Broadcast）一样，会有一组接收节点的地址列表，但指定为Anycast的数据包，只会发送给距离最近或发送成本最低（根据路由表来判断）的其中一个接收地址，当该接收地址收到数据包并进行回应，且加入后续的传输。该接收列表的其他节点，会知道某个节点地址已经回应了，它们就不再加入后续的传输作业。
    以目前的应用为例，Anycast地址只能分配给中间设备（如路由器、三层交换机等），不能分配给终端设备（手机、电脑等），而且不能作为发送端的地址。

3. 多播（multicast）地址

   >多播地址也称组播地址。多播地址也被指定到一群不同的接口，送到多播地址的数据包会被发送到所有的地址。多播地址由皆为一的字节起始，亦即：它们的前置为FF00::/8。其第二个字节的最后四个比特用以标明"范畴"。
    一般有node-local(0x1)、link-local(0x2)、site-local(0x5)、organization-local(0x8)和global(0xE)。多播地址中的最低112位会组成多播组群标识符，不过因为传统方法是从MAC地址产生，故只有组群标识符中的最低32位有使用。定义过的组群标识符有用于所有节点的多播地址0x1和用于所有路由器的0x2。
    另一个多播组群的地址为"solicited-node多播地址"，是由前置FF02::1:FF00:0/104和剩余的组群标识符（最低24位）所组成。这些地址允许经由邻居发现协议（NDP，Neighbor Discovery Protocol）来解译链接层地址，因而不用干扰到在区网内的所有节点。

4. 特殊地址

- 未指定地址：
>::/128－所有比特皆为零的地址称作未指定地址。这个地址不可指定给某个网络接口，
并且只有在主机尚未知道其来源IP时，才会用于软件中。路由器不可转送包含未指定地址的数据包。

- 链路本地地址：
>::1/128－是一种单播绕回地址。如果一个应用程序将数据包送到此地址，IPv6堆栈会转送这些数据包绕回到同样的虚拟接口（相当于IPv4中的127.0.0.1/8）。
>fe80::/10－这些链路本地地址指明，这些地址只在区域连线中是合法的，这有点类似于IPv4中的169.254.0.0/16。
   
- 唯一区域地址：
>fc00::/7－唯一区域地址（ULA，unique local address）只可用于本地通信，
类似于IPv4的专用网络地址10.0.0.0/8、172.16.0.0/12和192.168.0.0/16。这定义在RFC 4193中，是用来取代站点本地位域。
这地址包含一个40比特的伪随机数，以减少当网站合并或数据包误传到网络时碰撞的风险。
这些地址除了只能用于区域外，还具备全局性的范畴，这点违反了唯一区域位域所取代的站点本地地址的定义。
   
- 多播地址：
>ff00::/8－这个前置表明定义在"IP Version 6 Addressing Architecture"（RFC 4291）中的多播地址[12]。其中，有些地址已用于指定特殊协议，如ff0X::101对应所有区域的NTP服务器（RFC 2375）。

- 请求节点多播地址（Solicited-node multicast address）:
>ff02::1:FFXX:XXXX－XX:XXXX为相对应的单播或任播地址中的三个最低的字节。
   
- IPv4转译地址：
>2001::/32－用于Teredo隧道。
>2002::/16－用于6to4。
   
- ORCHID：
>2001:10::/28－ORCHID (Overlay Routable Cryptographic Hash Identifiers)（RFC 4843）。这些是不可遶送的IPv6地址，用于加密散列识别。
   
- 文件：
>2001:db8::/32－这前置用于文件（RFC 3849）。这些地址应用于IPV6地址的示例中，或描述网络架构。

#### 2.4 地址表示

ipv6地址在某些条家下的省略写法：

1. 每项数字前导的0可以省略，省略后前导数字仍是0则继续
    ipv6等价写法
    ```shell script
    2001:0DB8:02de:0000:0000:0000:0000:0e13
    2001:DB8:2de:0000:0000:0000:0000:e13
    2001:DB8:2de:000:000:000:000:e13
    2001:DB8:2de:00:00:00:00:e13
    2001:DB8:2de:0:0:0:0:e13
    ```

2. 可以用双冒号“::”表示一组0或多组连续的0，但只能出现一次
    ipv6等价写法
    ```shell script
    2001:0DB8:0000:0000:0000:0000:1428:57ab
    2001:0DB8:0000:0000:0000::1428:57ab
    2001:0DB8:0:0:0:0:1428:57ab
    2001:0DB8:0::0:1428:57ab
    2001:0DB8::1428:57ab
    ```
   
    这种情况下不能缩写为2001::25de::cade，不允许双冒号出现两次
    ```shell script
    2001:0000:0000:0000:0000:25de:0000:cade
    2001:0000:0000:0000:25de:0000:0000:cade
    2001:0000:0000:25de:0000:0000:0000:cade
    2001:0000:25de:0000:0000:0000:0000:cade
    ```

3.  如果这个地址实际上是IPv4的地址，后32位可以用10进制数表示；因此::ffff:192.168.89.9 相等于::ffff:c0a8:5909(ipv4映射地址)

#### 2.5 ipv6地址验证测试

curl ipv6
```
curl -g  -6 'http://[fd4b:8872:9025:63e9:8c05:d2da:ebc9:c2c0]'
```

telnet ipv6
```
telnet -6 fe80::3ad1:35ff:fe08:cd%eth0 80
```
%标明是本地的哪个网络接口

host域名解析ipv6
```
# host -t AAAA baidu.com
baidu.com has no AAAA record
# host -t AAAA google.com
google.com has IPv6 address 2404:6800:4005:80a::200e
```
baidu.com还不支持ipv6地址

dig域名解析ipv6
```
# dig -t AAAA google.com

; <<>> DiG 9.16.1-Ubuntu <<>> -t AAAA google.com
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 54941
;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1

;; OPT PSEUDOSECTION:
; EDNS: version: 0, flags:; udp: 65494
;; QUESTION SECTION:
;google.com.			IN	AAAA

;; ANSWER SECTION:
google.com.		13	IN	AAAA	2404:6800:4005:80a::200e

;; Query time: 0 msec
;; SERVER: 127.0.0.53#53(127.0.0.53)
;; WHEN: 一 11月 30 09:13:58 CST 2020
;; MSG SIZE  rcvd: 67


# dig -t AAAA baidu.com

; <<>> DiG 9.16.1-Ubuntu <<>> -t AAAA baidu.com
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 26898
;; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 0, ADDITIONAL: 1

;; OPT PSEUDOSECTION:
; EDNS: version: 0, flags:; udp: 65494
;; QUESTION SECTION:
;baidu.com.			IN	AAAA

;; Query time: 0 msec
;; SERVER: 127.0.0.53#53(127.0.0.53)
;; WHEN: 一 11月 30 09:14:03 CST 2020
;; MSG SIZE  rcvd: 38
```

### 3 宿主机配置ipv6

宿主机是centos系列系统
```
#加载ipv6内核模块
# vim /etc/modprobe.d/disable_ipv6.conf
options ipv6 disable=0

#启用ipv6网络
vim /etc/sysconfig/network
NETWORKING_IPV6=yes

#配置ipv6地址
# vim /etc/sysconfig/network-scripts/ifcfg-eth0 
IPV6INIT=yes
IPV6_AUTOCONF=no
IPV6ADDR=2003:ac18::30a:1/64

#配置ipv6网关
# route -A inet6 add default gw 2003:ac18::30a:254

#sysctl参数启用ipv6
vim /etc/sysctl.conf
net.ipv6.conf.all.disable_ipv6 = 0
net.ipv6.conf.default.disable_ipv6 = 0
net.ipv6.conf.lo.disable_ipv6 = 0
net.ipv6.conf.all.forwarding=1

sysctl -p
```

### 4 k8s启用ipv6

要启用IPv4/IPv6双协议栈，为集群的相关组件启用`IPv6DualStack`feature gates，并且设置双协议栈的集群网络分配：

k8s采用kubeadm方式部署

#### 4.1 kube-apiserver

```
# vim /etc/kubernetes/manifests/kube-apiserver.yaml
--feature-gates=IPv6DualStack=true
--service-cluster-ip-range=10.96.0.0/12,fd00::/108
```
kube-apiserver启用ipv6双栈特性, 并增加pod ipv6 cidr

#### 4.2 kube-controller-manager

```
# vim /etc/kubernetes/manifests/kube-controller-manager.yaml
--feature-gates=IPv6DualStack=true
--service-cluster-ip-range=10.96.0.0/12,fd00::/108
--cluster-cidr=172.16.0.0/16,fc00::/48
--node-cidr-mask-size-ipv4=24
--node-cidr-mask-size-ipv6=64
```
kube-controller-manager启用ipv6双栈特性, 并增加pod/service ipv6 cidr

#### 4.3 kubelet

```
# vim /etc/sysconfig/kubelet
KUBELET_EXTRA_ARGS="--feature-gates=IPv6DualStack=true"
```
kubelet启用ipv6双栈特性

#### 4.4 kube-proxy

```
# kubectl  -n kube-system edit cm kube-proxy
data:
  config.conf: |-
    ......
    featureGates:
      IPv6DualStack: true
    clusterCIDR: 172.16.0.0/16,fc00::/48
```
kube-proxy启用ipv6双栈特性, 并增加pod ipv6 cidr

### 5 cni插件启用双栈

#### 5.1 flannel

目前还没看到官方声明说支持ipv6，有个flannel官方issue关于ipv6[add IPv6 support](https://github.com/coreos/flannel/issues/248), 
有人在做基于vxlan模式的双栈

#### 5.2 calico

calico支持ipv4/ipv6双栈，这里采用calico v3.17版本. calico部署可以按节点规模来选择不同的形式：

- Install Calico with Kubernetes API datastore, 50 nodes or less
- Install Calico with Kubernetes API datastore, more than 50 nodes
- Install Calico with etcd datastore

这里选择第一种
```
# curl https://docs.projectcalico.org/manifests/calico.yaml -O
```

calico启用ipv4/ipv6双栈
```
# vim calico.yaml
#calico-config ConfigMap处
    "ipam": {
        "type": "calico-ipam",
        "assign_ipv4": "true",
        "assign_ipv6": "true"
    },
    - name: IP
      value: "autodetect"

    - name: IP6
      value: "autodetect"

    - name: CALICO_IPV4POOL_CIDR
      value: "172.16.0.0/16"

    - name: CALICO_IPV6POOL_CIDR
      value: "fc00::/48"

    - name: FELIX_IPV6SUPPORT
      value: "true"
```

```
# kubectl apply -f calico.yaml
```

```
# kubectl  -n kube-system get pod |grep calico
calico-kube-controllers-5dc87d545c-crmjv   1/1     Running       0          178m
calico-node-bjk7d                          1/1     Running       0          4h2m
calico-node-hhgm5                          1/1     Running       0          4h2m
```

### 6 kube-proxy模式

#### 6.1 iptables

如果是iptables模式，宿主机需要配置ipv6默认网关，不然curl访问不了ipv6 cluster ip. 见[issue](https://github.com/projectcalico/calico/issues/2758)

```
# route -6 -n |grep "::/0"
::/0                           2003:ac18::30a:254         UG   1   5   179 enp129s0f0
```
已配置完ipv6地址的默认网关，dummy的网关也可以

```
# kubectl -n kube-system edit cm kube-proxy
apiVersion: v1
data:
  config.conf: |-
    mode: "iptables"
```

```
kubectl apply -f - << EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: common-nginx
  labels:
    app: common-nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: common-nginx
  template:
    metadata:
      name: common-nginx
      labels:
        app: common-nginx
    spec:
      containers:
      - name: nginx
        image: nginx
        imagePullPolicy: IfNotPresent

---
apiVersion: v1
kind: Service
metadata:
  name: common-nginx
spec:
  ipFamily: IPv6
  ports:
  - name: proxy
    port: 80
    protocol: TCP
    targetPort: 80
  selector:
    app: common-nginx 
  sessionAffinity: None
  type: ClusterIP 
EOF
```

查看pod运行状态
```
# kubectl  get pod -o wide
NAME                            READY   STATUS        RESTARTS   AGE     IP              NODE     NOMINATED NODE   READINESS GATES
common-nginx-76457bb678-8d8xm   1/1     Running       0          2d16h   172.16.38.198   node53   <none>           <none>
common-nginx-76457bb678-q6vwt   1/1     Running       0          2d16h   172.16.38.196   node53   <none>           <none>
common-nginx-76457bb678-t6swz   1/1     Running       0          2d16h   172.16.38.195   node53   <none>           <none>
```

查看service ipv6 clusterIP
```
[root@node53 ~]# kubectl  get svc
NAME           TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
common-nginx   ClusterIP   fd00::9955   <none>        80/TCP    2d16h
```

访问ipv6 clusterIP
```
[root@node53 ~]# curl -I -g -6 'http://[fd00::9955]'
HTTP/1.1 200 OK
Server: nginx/1.19.5
Date: Mon, 30 Nov 2020 02:18:24 GMT
Content-Type: text/html
Content-Length: 612
Last-Modified: Tue, 24 Nov 2020 13:02:03 GMT
Connection: keep-alive
ETag: "5fbd044b-264"
Accept-Ranges: bytes
```

#### 6.2 ipvs

```
# kubectl -n kube-system edit cm kube-proxy
apiVersion: v1
data:
  config.conf: |-
    mode: "ipvs"
```

重启kube-proxy pod
```
kubectl -n kube-system get pod -l k8s-app=kube-proxy | grep -v 'NAME' | awk '{print $1}' | xargs kubectl -n kube-system delete pod
```

清除iptables模式的残留的规则
```
iptables -t filter -F; iptables -t filter -X; iptables -t nat -F; iptables -t nat -X;
```

删除ipv6默认网关(只为测试，正式环境都会有一个默认网关的)
```
# ip -6 route delete default via 2003:ac18::30a:254
```

ipvs模式下不需要配置ipv6默认网关，宿主机也可以访问clusterIP
```
# curl -I -g -6 'http://[fd00::9955]'
HTTP/1.1 200 OK
Server: nginx/1.19.5
Date: Mon, 30 Nov 2020 02:37:45 GMT
Content-Type: text/html
Content-Length: 612
Last-Modified: Tue, 24 Nov 2020 13:02:03 GMT
Connection: keep-alive
ETag: "5fbd044b-264"
Accept-Ranges: bytes
```

### 7 ingress类型

#### 7.1 nginx-ingress-controller

```
# wget -c https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v0.41.2/deploy/static/provider/cloud/deploy.yaml
```

把80/443映射端口的service类型改成NodePort
```
# vim deploy.yaml
# Source: ingress-nginx/templates/controller-service.yaml
......
spec:
  type: NodePort
```

```
# kubectl apply -f deploy.yaml
```

```
# kubectl  -n ingress-nginx get pod
NAME                                       READY   STATUS      RESTARTS   AGE
ingress-nginx-admission-create-t2h6f       0/1     Completed   0          3m24s
ingress-nginx-admission-patch-cj9c9        0/1     Completed   0          3m24s
ingress-nginx-controller-c4f944d4d-n2v5z   1/1     Running     0          3m24s

# kubectl  -n ingress-nginx get svc
NAME                                 TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)                      AGE
ingress-nginx-controller             NodePort    10.104.175.58   <none>        80:30080/TCP,443:30443/TCP   3m27s
ingress-nginx-controller-admission   ClusterIP   10.97.232.105   <none>        443/TCP                      8m39s
```

```
# netstat -plunt4
Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name    
tcp        0      0 0.0.0.0:30080           0.0.0.0:*               LISTEN      54678/kube-proxy  
```
NodePort服务监听的地址在ipv4上，导致访问ipv6地址:30409不通。为什么NodePort服务会监听的地址在ipv4上？ 指定nodePort地址是否有效？
```
#给kube-proxy指定nodePort地址范围, 范围是节点地址cidr(包含ipv4和ipv6)
# kubectl  -n kube-system edit cm kube-proxy
apiVersion: v1
data:
  config.conf: |-
    nodePortAddresses: ["2003:ac18::30a:2/64", "192.168.101.53/24"]
```
重启kube-proxy pod

把80/443映射端口的service类型改成NodePort, 指定为ipv6
```
# vim deploy.yaml
# Source: ingress-nginx/templates/controller-service.yaml
......
spec:
  type: NodePort
  ipFamily: IPv6
  ports:
    - name: http
      port: 80
      protocol: TCP
      nodePort: 30080
      targetPort: http
    - name: https
      port: 443
      nodePort: 30443
      protocol: TCP
      targetPort: https
```

```
# kubectl apply -f deploy.yaml
```

```
# kubectl -n ingress-nginx get svc
NAME                                 TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)                      AGE
ingress-nginx-controller             NodePort    fd00::c3bf      <none>        80:30080/TCP,443:30443/TCP   9m35s
ingress-nginx-controller-admission   ClusterIP   10.107.114.87   <none>        443/TCP                      9m35s
 
# netstat -plunt6 |grep 30080
tcp6       0      0 2003:ac18::30a:2:30080  :::*                    LISTEN      29276/kube-proxy 
```
可以看到nginx-ingress-controller服务监听在ipv6地址上

接下来继续下面的验证测试，创建common-nginx ingress规则
```
kubectl apply -f - << EOF
apiVersion: networking.k8s.io/v1beta1 
kind: Ingress
metadata:
  name: common-nginx
spec:
  rules:
  - host: common-nginx.test.com
    http:
      paths:
      - path: /
        backend:
          serviceName: common-nginx
          servicePort: 80
EOF
```

curl访问域名，访问正常
```
# curl -H "Host: common-nginx.test.com" -I -g -6 'http://[2003:ac18::30a:2]:30080'
HTTP/1.1 200 OK
Date: Mon, 30 Nov 2020 07:28:53 GMT
Content-Type: text/html
Content-Length: 612
Connection: keep-alive
Last-Modified: Tue, 24 Nov 2020 13:02:03 GMT
ETag: "5fbd044b-264"
Accept-Ranges: bytes
```

#### 7.2 kong-ingress-controller

kong-ingress-controller/konga部署参考：[kong-ingress-controller实践](http://www.iceyao.com.cn/2019/12/18/kong-ingress-controller%E5%AE%9E%E8%B7%B5/)

修改Deployment，增加ipv6地址监听
```
- name: KONG_PROXY_LISTEN
  value: "0.0.0.0:8000, 0.0.0.0:8443 ssl http2, [::]:8000,[::]:8443 ssl http2"
```

修改ingress-kong service, 指定ipFamily为IPv6，指定nodePort
```
apiVersion: v1
kind: Service
metadata:
  name: kong-proxy
  namespace: kong
spec:
  ipFamily: IPv6
  ports:
  - name: proxy
    port: 80
    protocol: TCP
    nodePort: 30080
    targetPort: 8000
  - name: proxy-ssl
    port: 443
    protocol: TCP
    nodePort: 30443
    targetPort: 8443
  selector:
    app: ingress-kong
  type: NodePort
```

查看ingress-kong运行状态
```
# kubectl -n kong get pod
NAME                            READY   STATUS    RESTARTS   AGE
ingress-kong-6876c9b59c-g4mqz   2/2     Running   1          2m52s
ingress-kong-6876c9b59c-n2pzv   2/2     Running   1          2m52s
```

```
# kubectl  apply -f all-in-one-dbless.yaml
```

```
[root@node53 ~]# kubectl -n kong get pod ingress-kong-6876c9b59c-g4mqz -o go-template --template='{{range .status.podIPs}}{{printf "%s \n" .ip}}{{end}}'
172.16.38.202 
fc00::26d1:ddab:d697:fe01:78ca 
```

再次进行curl访问验证，访问失败
```
# curl -H "Host: common-nginx.test.com" -I -g -6 'http://[2003:ac18::30a:2]:30080'
HTTP/1.1 502 Bad Gateway
Date: Mon, 30 Nov 2020 08:26:41 GMT
Content-Type: text/plain; charset=UTF-8
Connection: keep-alive
Server: kong/1.4.2
X-Kong-Upstream-Latency: 1003
X-Kong-Proxy-Latency: 5010
Via: kong/1.4.2
```
通过查看konga web界面看到kong-ingress-controller生成的kong target规则不对，升级kong-ingress-controller版本试试？经过测试master版本也有这问题

问题分析:

查看生成的endpoints
```
# kubectl get endpoints
NAME           ENDPOINTS                                                                                                     AGE
common-nginx   [fc00::26d1:ddab:d697:fe01:78ea]:80,[fc00::26d1:ddab:d697:fe01:78ec]:80,[fc00::26d1:ddab:d697:fe01:78ee]:80   59m
```

调用kong api获取config配置查看到ipv6地址并没有用[]括起来
```
# curl -k https://127.0.0.1:8001/config
target: fc00::26d1:ddab:d697:fe01:78ee:80
```

```
#kong的日志

020/11/30 12:03:20 [debug] 22#0: *4 [lua] ring.lua:495: new(): [upstream:common-nginx.default.80.svc 1] ringbalancer created
2020/11/30 12:03:20 [debug] 22#0: *4 [lua] base.lua:841: newHost(): [upstream:common-nginx.default.80.svc 1] created a new host for: [fc00:0000:26d1:ddab:d697:fe01:78ea:0080]
2020/11/30 12:03:20 [debug] 22#0: *4 [lua] base.lua:584: queryDns(): [upstream:common-nginx.default.80.svc 1] querying dns for [fc00:0000:26d1:ddab:d697:fe01:78ea:0080]
2020/11/30 12:03:20 [debug] 22#0: *4 [lua] base.lua:499: f(): [upstream:common-nginx.default.80.svc 1] dns record type changed for [fc00:0000:26d1:ddab:d697:fe01:78ea:0080], nil -> 28
2020/11/30 12:03:20 [debug] 22#0: *4 [lua] base.lua:361: newAddress(): [upstream:common-nginx.default.80.svc 1] new address for host '[fc00:0000:26d1:ddab:d697:fe01:78ea:0080]' created: [fc00:0000:26d1:ddab:d697:fe01:78ea:0080]:8000 (weight 100)
2020/11/30 12:03:20 [debug] 22#0: *4 [lua] base.lua:563: f(): [upstream:common-nginx.default.80.svc 1] updating balancer based on dns changes for [fc00:0000:26d1:ddab:d697:fe01:78ea:0080]
2020/11/30 12:03:20 [debug] 22#0: *4 [lua] ring.lua:246: redistributeIndices(): [upstream:common-nginx.default.80.svc 1] redistributed indices, size=10000, dropped=0, assigned=10000, left unassigned=0
2020/11/30 12:03:20 [debug] 22#0: *4 [lua] base.lua:573: f(): [upstream:common-nginx.default.80.svc 1] querying dns and updating for [fc00:0000:26d1:ddab:d697:fe01:78ea:0080] completed
2020/11/30 12:03:20 [debug] 22#0: *4 [lua] base.lua:841: newHost(): [upstream:common-nginx.default.80.svc 1] created a new host for: [fc00:0000:26d1:ddab:d697:fe01:78ee:0080]
2020/11/30 12:03:20 [debug] 22#0: *4 [lua] base.lua:584: queryDns(): [upstream:common-nginx.default.80.svc 1] querying dns for [fc00:0000:26d1:ddab:d697:fe01:78ee:0080]
2020/11/30 12:03:20 [debug] 22#0: *4 [lua] base.lua:499: f(): [upstream:common-nginx.default.80.svc 1] dns record type changed for [fc00:0000:26d1:ddab:d697:fe01:78ee:0080], nil -> 28
2020/11/30 12:03:20 [debug] 22#0: *4 [lua] base.lua:361: newAddress(): [upstream:common-nginx.default.80.svc 1] new address for host '[fc00:0000:26d1:ddab:d697:fe01:78ee:0080]' created: [fc00:0000:26d1:ddab:d697:fe01:78ee:0080]:8000 (weight 100)
```
kong把80端口也当作是ipv6地址的一部分了，问题应该是在ipv6环境下，kong-ingress-cntroller把endpoints解析成target地址的方式有问题，这里给官方提了个[PR](https://github.com/Kong/kubernetes-ingress-controller/pull/973)

### 结论

- calico支持ipv4/ipv6双栈，原生的flannel目前不支持ipv6
- kube-proxy iptables/ipvs模式均访问正常，iptables模式下需要配置宿主机的默认ipv6网关，不然宿主机访问不了clusterIP
- nginx-ingress-controller支持双栈,原生的kong-ingress-controller不支持双栈

### flannel支持ipv6开发

flannel默认使用host-local ipam插件用于分配ip地址
```
# echo '{ "cniVersion": "0.3.1", "name": "examplenet", "ipam": { "type": "host-local", "ranges": [ [{"subnet": "203.0.113.0/24"}], [{"subnet": "2001:db8:1::/64"}]], "dataDir": "/tmp/cni-example"  } }' | CNI_COMMAND=ADD CNI_CONTAINERID=example CNI_NETNS=/dev/null CNI_IFNAME=dummy0 CNI_PATH=. /opt/cni/bin/host-local 
{
    "cniVersion": "0.3.1",
    "ips": [
        {
            "version": "4",
            "address": "203.0.113.2/24",
            "gateway": "203.0.113.1"
        },
        {
            "version": "6",
            "address": "2001:db8:1::2/64",
            "gateway": "2001:db8:1::1"
        }
    ],
    "dns": {}
}
```
测试host-local是否支持双栈，从结果来看是支持的. 接下来定位flannel不支持ipv6处的代码：

部署flannel, Kubernetes v1.17+环境
```
kubectl apply -f https://raw.githubusercontent.com/coreos/flannel/master/Documentation/kube-flannel.yml
```

配置service ipFamily=IPv6，验证ipv6地址不通
```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: common-nginx
  labels:
    app: common-nginx
spec:
  replicas: 1
  selector:
    matchLabels:
      app: common-nginx
  template:
    metadata:
      name: common-nginx
      labels:
        app: common-nginx
    spec:
      containers:
      - name: nginx
        image: nginx
        imagePullPolicy: IfNotPresent
---
apiVersion: v1
kind: Service
metadata:
  name: common-nginx
spec:
  ipFamily: IPv6
  ports:
  - name: proxy
    port: 80
    protocol: TCP
    targetPort: 80
  selector:
    app: common-nginx 
  sessionAffinity: None
  type: ClusterIP 
---
apiVersion: extensions/v1beta1 
kind: Ingress
metadata:
  name: common-nginx
  annotations:
    kubernetes.io/ingress.class: kong 
spec:
  rules:
  - host: common-nginx.test.com
    http:
      paths:
      - path: /
        backend:
          serviceName: common-nginx
          servicePort: 80
```

分析问题：
查阅flannel代码，子网分配器就不支持ipv6;如果是ipv4地址，32位，也就是4个字节，golang uint32类型就可以容纳。如果是ipv6地址呢？
>ipv6地址，128位，也就是16个字节，golang中并没有uint128类型，如何实现ipv6<->int相互转换呢？
>`github.com/coreos/flannel/pkg/ip/ipnet.go`里定义的都是ipv4<->int逻辑，calico如何实现ipv4、ipv6子网管理呢？

自动生成ipv6地址的前缀
```
func GenerateIPv6ULAPrefix() (string, error) {
	ulaAddr := []byte{0xfd, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}
	_, err := cryptorand.Read(ulaAddr[1:6])
	if err != nil {
		return "", err
	}
	ipNet := net.IPNet{
		IP:   net.IP(ulaAddr),
		Mask: net.CIDRMask(48, 128),
	}
	return ipNet.String(), nil
}
```
ulaAddr代表一个ipv6地址，是128位，也就是16个字节；cryptorand.Read(ulaAddr[1:6])的作用是让第1个字节到第5个字节的值随机生成，第0个字节是0xfd

calico-ipam中ipv4/ipv6<->int相互转换
```
# github.com/projectcalico/libcalico-go/lib/net/ip.go
package net

import (
	"encoding/json"
	"math/big"
	"net"
)

// Sub class net.IP so that we can add JSON marshalling and unmarshalling.
type IP struct {
	net.IP
}

// Sub class net.IPNet so that we can add JSON marshalling and unmarshalling.
type IPNet struct {
	net.IPNet
}

// MarshalJSON interface for an IP
func (i IP) MarshalJSON() ([]byte, error) {
	s, err := i.MarshalText()
	if err != nil {
		return nil, err
	}
	return json.Marshal(string(s))
}

// UnmarshalJSON interface for an IP
func (i *IP) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	if err := i.UnmarshalText([]byte(s)); err != nil {
		return err
	}
	// Always return IPv4 values as 4-bytes to be consistent with IPv4 IPNet
	// representations.
	if ipv4 := i.To4(); ipv4 != nil {
		i.IP = ipv4
	}

	return nil
}

// ParseIP returns an IP from a string
func ParseIP(ip string) *IP {
	addr := net.ParseIP(ip)
	if addr == nil {
		return nil
	}
	// Always return IPv4 values as 4-bytes to be consistent with IPv4 IPNet
	// representations.
	if addr4 := addr.To4(); addr4 != nil {
		addr = addr4
	}
	return &IP{addr}
}

// Version returns the IP version for an IP, or 0 if the IP is not valid.
func (i IP) Version() int {
	if i.To4() != nil {
		return 4
	} else if len(i.IP) == net.IPv6len {
		return 6
	}
	return 0
}

// Network returns the IP address as a fully masked IPNet type.
func (i *IP) Network() *IPNet {
	// Unmarshaling an IPv4 address returns a 16-byte format of the
	// address, so convert to 4-byte format to match the mask.
	n := &IPNet{}
	if ip4 := i.IP.To4(); ip4 != nil {
		n.IP = ip4
		n.Mask = net.CIDRMask(net.IPv4len*8, net.IPv4len*8)
	} else {
		n.IP = i.IP
		n.Mask = net.CIDRMask(net.IPv6len*8, net.IPv6len*8)
	}
	return n
}

// MustParseIP parses the string into an IP.
func MustParseIP(i string) IP {
	var ip IP
	err := ip.UnmarshalText([]byte(i))
	if err != nil {
		panic(err)
	}
	// Always return IPv4 values as 4-bytes to be consistent with IPv4 IPNet
	// representations.
	if ip4 := ip.To4(); ip4 != nil {
		ip.IP = ip4
	}
	return ip
}

func IPToBigInt(ip IP) *big.Int {
	if ip.To4() != nil {
		return big.NewInt(0).SetBytes(ip.To4())
	} else {
		return big.NewInt(0).SetBytes(ip.To16())
	}
}

func BigIntToIP(ipInt *big.Int) IP {
	ip := net.IP(ipInt.Bytes())
	if ip.To4() != nil {
		return IP{ip}
	}
	a := ipInt.FillBytes(make([]byte, 16))
	return IP{net.IP(a)}
}

func IncrementIP(ip IP, increment *big.Int) IP {
	sum := big.NewInt(0).Add(IPToBigInt(ip), increment)
	return BigIntToIP(sum)
}
```

flannel vxlan后端双栈支持改造过程：
1. host-local ipam cni插件已支持双栈ip地址分配，flannel cni插件需要适配host-local ipam cni插件
```
"ranges": [ [{"subnet": "203.0.113.0/24"}], [{"subnet": "2001:db8:1::/64"}]]
```
2. flannel启动程序增加`--auto-detect-ipv6`自动检测节点主机ipv6地址
3. flannel配置文件`net-conf.json`增加IPv6 cidr配置   
4. flannel添加ipv6 ip/子网运算库，引入big.Int库(参考calico)
5. flannel增加ip6tables处理逻辑，参考原先iptables处理逻辑
6. node节点增加flannel ipv6信息annotation
```
  annotations:
    flannel.alpha.coreos.com/backend-data: '{"VNI":1,"VtepMAC":"12:62:b6:2a:21:cf"}'
    flannel.alpha.coreos.com/backend-type: vxlan
    flannel.alpha.coreos.com/backend-v6-data: '{"VNI":1,"VtepMAC":"ba:5d:da:3f:78:e1"}'
    flannel.alpha.coreos.com/kube-subnet-manager: "true"
    flannel.alpha.coreos.com/public-ip: 1.1.33.34
    flannel.alpha.coreos.com/public-ipv6: 2003:ac18::30a:2
    node.alpha.kubernetes.io/ttl: "0"
    volumes.kubernetes.io/controller-managed-attach-detach: "true"
```
7. flannel k8s子网管理器增加ipv6子网管理
8. flannel vxlan ipv6隧道创建，创建flannel-v6.1 vxlan设备用于ipv6隧道连通
9. flannel监听子网变化事件，增加ipv6子网事件监听
10. flannel arp，vxlan fdb，增加ipv6地址记录

### 参考链接

- [IPv4/IPv6 双协议栈](https://kubernetes.io/zh/docs/concepts/services-networking/dual-stack/)
- [验证 IPv4/IPv6 双协议栈](https://kubernetes.io/zh/docs/tasks/network/validate-dual-stack/)
- [calico启用双栈](https://docs.projectcalico.org/networking/ipv6#enable-dual-stack)
- [calico部署](https://docs.projectcalico.org/getting-started/kubernetes/self-managed-onprem/onpremises)
- [ipv6介绍](https://zh.wikipedia.org/wiki/IPv6)
- [host-local cni插件](https://www.cni.dev/plugins/ipam/host-local/)
