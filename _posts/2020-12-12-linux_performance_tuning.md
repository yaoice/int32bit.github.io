---
layout: post
title: linux系统调优
subtitle: ""
catalog: true
hide: true
tags:
     - linux
---

## 1 网络性能

### 1.1 网络协议层

ISO/OSI网络模型
```
应用层
表示层
会话层
传输层
网络层
链路层
物理层
```

TCP/IP模型
```
应用层 -> 应用上的协议有HTTP、DNS、FTP、POP3、SMTP、DHCP等
传输层 -> 传输的质量问题；是否面向连接，是否可靠; TCP/UDP
网络层 -> 打通底层所有网络(ip协议)
链路层 -> 解决不同网络拓扑结构导致的组网差异
物理层
```
TCP/IP模型实际上不负责物理层，默认已存在；

ARP协议位于哪一层？
>在OSI模型中ARP协议属于链路层, 而在TCP/IP模型中，ARP协议属于网络层;
>个人觉得ARP协议介于网络层和链路层之间

TCP/IP三次握手、四次挥手
<img src="/img/posts/2020-12-12/tcp-ip.png"/>

TCP/IP状态相互转化：
<img src="/img/posts/2020-12-12/tcp-ip-status.png"/>

### 1.2 网络常用监控命令

unix网络三套件：netstat、ifconfig、route(net-tools包提供)

linux 内核2.4之后使用了iproute2，iproute2提供了一套可实现相同功能的新命令：ss、ip；
这套命令基于内核新模块实现，查询更高效.

#### 1.2.1 netstat

netstat本质上用于显示socket状态，stat系列命令还有iostat、mpstat、vmstat

-a：所有socket连接
-n：不把IP反解析成域名
-t：TCP
-p: 打印进程号
```
# netstat -antp
Active Internet connections (servers and established)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name    
tcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN      9736/kube-proxy     
tcp        0      0 0.0.0.0:5340            0.0.0.0:*               LISTEN      9736/kube-proxy     
tcp        0      0 0.0.0.0:17917           0.0.0.0:*               LISTEN      9736/kube-proxy  
```

```
# netstat -anup
Active Internet connections (servers and established)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name    
udp        0      0 0.0.0.0:45176       0.0.0.0:*                           22752/sap1015       
udp        0      0 0 0.0.0.0:38712       0.0.0.0:*                           22752/sap1015     
```

显示协议栈里面比较重要的计数器
```
# netstat -s
Ip:
    2632962443 total packets received
    1168756774 forwarded
    0 incoming packets discarded
    1464185243 incoming packets delivered
    2642503480 requests sent out
    30 dropped because of missing route
Icmp:
    46084310 ICMP messages received
    20100 input ICMP message failed.
    ICMP input histogram:
        destination unreachable: 37132827
        timeout in transit: 1
        echo requests: 8951025
        echo replies: 321
        timestamp request: 136
    45534912 ICMP messages sent
    0 ICMP messages failed
    ICMP output histogram:
        destination unreachable: 36583239
        echo request: 512
        echo replies: 8951025
        timestamp replies: 136
IcmpMsg:
        InType0: 321
        InType3: 37132827
        InType8: 8951025
        InType11: 1
        InType13: 136
        OutType0: 8951025
        OutType3: 36583239
        OutType8: 512
        OutType14: 136
Tcp:
    60003367 active connections openings
    54155042 passive connection openings
    3761426 failed connection attempts
    9024728 connection resets received
    277 connections established
    1399841003 segments received
    1424047510 segments send out
    4446484 segments retransmited
    28 bad segments received.
    51218394 resets sent
Udp:
    1447459 packets received
    36563515 packets to unknown port received.
    0 packet receive errors
    37679860 packets sent
    0 receive buffer errors
    0 send buffer errors
UdpLite:
TcpExt:
    782602 invalid SYN cookies received
    572 resets received for embryonic SYN_RECV sockets
    1315 packets pruned from receive queue because of socket buffer overrun
    11 ICMP packets dropped because socket was locked
    37257858 TCP sockets finished time wait in fast timer
    285 packets rejects in established connections because of timestamp
    24510697 delayed acks sent
    2685 delayed acks further delayed because of locked socket
    Quick ack mode was activated 6953799 times
    9107 times the listen queue of a socket overflowed
    9107 SYNs to LISTEN sockets dropped
    1489 packets directly queued to recvmsg prequeue.
    33492 bytes directly in process context from backlog
    10 bytes directly received in process context from prequeue
    411573977 packet headers predicted
    19 packets header predicted and directly queued to user
    232193954 acknowledgments not containing data payload received
    332343622 predicted acknowledgments
    21680 times recovered from packet loss by selective acknowledgements
    Detected reordering 24 times using FACK
    Detected reordering 41 times using SACK
    Detected reordering 1482 times using time stamp
    4753 congestion windows fully recovered without slow start
    1520 congestion windows partially recovered using Hoe heuristic
    13621 congestion windows recovered without slow start by DSACK
    674 congestion windows recovered without slow start after partial ack
    TCPLostRetransmit: 28
    13 timeouts after SACK recovery
    30013 fast retransmits
    11251 forward retransmits
    66 retransmits in slow start
    1742135 other TCP timeouts
    TCPLossProbes: 211831
    TCPLossProbeRecovery: 26484
    3 SACK retransmits failed
    20791 packets collapsed in receive queue due to low socket buffer
    6953811 DSACKs sent for old packets
    17 DSACKs sent for out of order packets
    35624 DSACKs received
    1 DSACKs for out of order packets received
    11249124 connections reset due to unexpected data
    5562035 connections reset due to early user close
    112739 connections aborted due to timeout
    TCPDSACKIgnoredOld: 2
    TCPDSACKIgnoredNoUndo: 15593
    TCPSpuriousRTOs: 3
    TCPSackMerged: 2
    TCPSackShiftFallback: 296068
    TCPBacklogDrop: 53
    IPReversePathFilter: 106
    TCPTimeWaitOverflow: 2027
    TCPRcvCoalesce: 45113470
    TCPOFOQueue: 229745
    TCPOFOMerge: 17
    TCPChallengeACK: 68796
    TCPSYNChallenge: 30
    TCPAutoCorking: 7149
    TCPFromZeroWindowAdv: 45
    TCPToZeroWindowAdv: 45
    TCPWantZeroWindowAdv: 7796
    TCPSynRetrans: 3335473
    TCPOrigDataSent: 819593815
    TCPHystartTrainDetect: 16982
    TCPHystartTrainCwnd: 321758
    TCPHystartDelayDetect: 10
    TCPHystartDelayCwnd: 1148
    TCPACKSkippedPAWS: 9
    TCPACKSkippedSeq: 117
    TCPACKSkippedChallenge: 5
IpExt:
    InNoRoutes: 53
    InMcastPkts: 190832
    InOctets: 599836950972
    OutOctets: 954183523224
    InMcastOctets: 6869952
    InNoECTPkts: 2756087476
    InECT0Pkts: 4050
```
可以指定打印某个协议栈的信息，也可以间隔时间打印.命令格式：`netstat {--statistics|-s} [--tcp|-t] [--udp|-u] [--udplite|-U] [--sctp|-S] [--raw|-w] [delay]`

#### 1.2.2 ifconfig

查看网卡信息，修改网卡信息
```
# ifconfig eth1
eth1: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500
        inet 9.134.12.85  netmask 255.255.240.0  broadcast 9.134.15.255
        inet6 fe80::5054:ff:fe02:fcf3  prefixlen 64  scopeid 0x20<link>
        ether 52:54:00:02:fc:f3  txqueuelen 1000  (Ethernet)
        RX packets 646798217  bytes 137039458113 (127.6 GiB)
        RX errors 0  dropped 0  overruns 0  frame 0
        TX packets 961762924  bytes 205863555339 (191.7 GiB)
        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0
```
通常关注以下值，值越低，网络性能越好；如果值越高，说明当前网络可能硬件性能存在问题.

- txqueuelen: 发包的缓存队列长度(长度是包的个数)
- RX errors: 因错误的包产生的丢包
- dropped: 可能性能问题产生的丢包
- overruns: 超出负荷产生的丢包
- frame：帧错误(网卡硬件内部错误)产生的丢包
- carrier: 链路脉冲产生的丢包，比如电缆问题、强电干扰等
- collisions: 包碰撞产生的丢包

#### 1.2.3 route

查看路由表
```
# route -n
Kernel IP routing table
Destination     Gateway         Genmask         Flags Metric Ref    Use Iface
0.0.0.0         1.1.0.1         0.0.0.0         UG    0      0        0 eth1
1.0.0.0         1.1.0.1         255.0.0.0       UG    0      0        0 eth1
1.1.0.0         0.0.0.0         255.255.240.0   U     0      0        0 eth1
```
匹配原则：精确优先匹配

发到127.0.0.1的包怎么没在`route -n`的路由表体现？
```
#系统默认存在不止一张路由表，打印全部路由表的规则可看到
# ip route show table all |grep 127.0.0.1
broadcast 127.0.0.0 dev lo table local proto kernel scope link src 127.0.0.1 
local 127.0.0.0/8 dev lo table local proto kernel scope host src 127.0.0.1 
local 127.0.0.1 dev lo table local proto kernel scope host src 127.0.0.1 
broadcast 127.255.255.255 dev lo table local proto kernel scope link src 127.0.0.1 
```
路由表定义在`/etc/iproute2/rt_tables`，可支持256个路由表，系统默认带有0(unspec)、253(default)、254(main)、255(local)路由表


#### 1.2.4 ss 

```
# ss -antp
State      Recv-Q Send-Q                        Local Address:Port                                       Peer Address:Port              
LISTEN     0      128                                       *:443                                                   *:*                   users:(("kube-proxy",pid=9736,fd=17))
LISTEN     0      128                                       *:5340                                                  *:*                   users:(("kube-proxy",pid=9736,fd=15))
LISTEN     0      128                                       *:17917                                                 *:*                   users:(("kube-proxy",pid=9736,fd=16))
LISTEN     0      128                                       *:35517                                                 *:*   
```

```
# ss -anup 
State      Recv-Q Send-Q                        Local Address:Port                                       Peer Address:Port              
UNCONN     0      0                                         *:8472                                                  *:*                  
UNCONN     0      0                                   1.1.1.1:45176                                                 *:*                   users:(("sap1015",pid=22752,fd=13))
UNCONN     0      0                                   1.1.1.1:38712                                                 *:*                   users:(("sap1015",pid=22752,fd=14))
UNCONN     0      0                                         *:7315                                                  *:*                   users:(("dhclient",pid=3779,fd=20))
UNCONN     0      0                                   127.0.0.1:48555                                               *:*                   users:(("sap1015",pid=22752,fd=10))
```

显示所有处于建立状态的ssh连接
```
ss -o state established '( dport = :ssh or sport = :ssh )'
```
可以根据状态过滤显示，其它可用的状态有：`established, syn-sent, syn-recv, fin-wait-1, fin-wait-2, time-wait, closed,  close-wait,  last-ack, listen and closing`


#### 1.2.5 ip

查看网卡网络地址
```
# ip address show|ls
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host 
       valid_lft forever preferred_lft forever
2: eth1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    link/ether 52:54:00:02:fc:f3 brd ff:ff:ff:ff:ff:ff
    inet 9.134.12.85/20 brd 9.134.15.255 scope global eth1
       valid_lft forever preferred_lft forever
    inet6 fe80::5054:ff:fe02:fcf3/64 scope link 
       valid_lft forever preferred_lft forever
```

查看网卡mac地址
```
# ip link show|ls
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: eth1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP mode DEFAULT group default qlen 1000
    link/ether 52:54:00:02:fc:f3 brd ff:ff:ff:ff:ff:ff
```

查看arp缓存
```
# ip neigh show|ls
172.20.0.17 dev v-h28edb3920 lladdr ee:7a:dd:24:73:ee REACHABLE
172.17.0.2 dev docker0 lladdr 02:42:ac:11:00:02 STALE
```

查看路由表
```
# ip route show
default via 1.1.0.1 dev eth1 
1.0.0.0/8 via 1.1.0.1 dev eth1 
1.1.0.0/20 dev eth1 proto kernel scope link src 1.1.1.85 
```

查看策略路由
```
# ip rule show 
0:      from all lookup local 
32766:  from all lookup main 
32767:  from all lookup default 
```
可以加32768条策略路由

#### 1.2.6 tc

网络资源隔离用tc来实现
```
# tc qdisc ls
qdisc noqueue 0: dev lo root refcnt 2 
qdisc mq 0: dev eth1 root 
qdisc pfifo_fast 0: dev eth1 parent :2 bands 3 priomap  1 2 2 2 1 2 0 0 1 1 1 1 1 1 1 1
qdisc pfifo_fast 0: dev eth1 parent :1 bands 3 priomap  1 2 2 2 1 2 0 0 1 1 1 1 1 1 1 1
qdisc noqueue 0: dev docker0 root refcnt 2 
qdisc noqueue 0: dev flannel.1 root refcnt 2 
```

#### 1.2.7 sar

sar号称系统状态检测的"瑞士军刀"，支持系统网络/内存/CPU/磁盘检测

显示网络统计信息
```
# sar -n DEV 1
Linux 3.10.0-862.11.6.el7.x86_64 (ice)  12/14/2020      _x86_64_        (8 CPU)

02:30:48 PM     IFACE   rxpck/s   txpck/s    rxkB/s    txkB/s   rxcmp/s   txcmp/s  rxmcst/s
02:30:49 PM v-h2c6f7989a      1.00      1.00      0.04      0.04      0.00      0.00      0.00
02:30:49 PM v-h1015e1139      7.00      7.00      1.17      2.30      0.00      0.00      0.00
02:30:49 PM v-hcd1540d8b      0.00      0.00      0.00      0.00      0.00      0.00      0.00
02:30:49 PM v-h1ce426bc4      5.00      5.00      0.42      0.45      0.00      0.00      0.00
02:30:49 PM v-h36f57a7fa      0.00      0.00      0.00      0.00      0.00      0.00      0.00
02:30:49 PM v-h116a4956b    401.00    219.00     34.72     53.83      0.00      0.00      0.00
02:30:49 PM v-h3a0f0ebe8      8.00     11.00      0.56     10.86      0.00      0.00      0.00
02:30:49 PM v-h55d00ad6f      0.00      0.00      0.00      0.00      0.00      0.00      0.00
```
-n：表示跟网络相关，后面可以加`DEV, EDEV, NFS, NFSD, SOCK, IP, EIP, ICMP, EICMP, TCP, ETCP, UDP, SOCK6, IP6, EIP6, ICMP6, EICMP6, UDP6.`

#### 1.2.8 tcpdump

抓包工具

#### 1.2.9 nmap

扫描端口工具

扫描本地80端口
```
# nmap -sT -p 80 127.0.0.1

Starting Nmap 6.40 ( http://nmap.org ) at 2020-12-14 15:41 CST
Nmap scan report for VM-12-85-centos (127.0.0.1)
Host is up (0.000073s latency).
PORT   STATE  SERVICE
80/tcp closed http

Nmap done: 1 IP address (1 host up) scanned in 0.02 seconds
```

扫描参数区别：
```
-sS/sT/sA/sW/sM: TCP SYN/Connect()/ACK/Window/Maimon scans
-sU: UDP Scan
-sN/sF/sX: TCP Null, FIN, and Xmas scans
--scanflags <flags>: Customize TCP scan flags
-sI <zombie host[:probeport]>: Idle scan
-sY/sZ: SCTP INIT/COOKIE-ECHO scans
-sO: IP protocol scan
-b <FTP relay host>: FTP bounce scan
```

#### 1.2.10 ping

```
# ping -f -c 1000 -s 1472 9.135.22.34
PING 9.135.22.34 (9.135.22.34) 1472(1500) bytes of data.
 
--- 9.135.22.34 ping statistics ---
1000 packets transmitted, 1000 received, 0% packet loss, time 149ms
rtt min/avg/max/mdev = 0.107/0.123/0.981/0.030 ms, ipg/ewma 0.149/0.123 ms
```
```
-f: 洪泛ping
-c: 指定包的个数
-s: 指定数据包的长度，可用于测试网卡的MTU设置，MTU一般为1500=数据包长度+数据包头28字节(ip首部20字节+icmp包头8字节)
```

### 1.3 套接字socket

```
# man socket
SOCKET(2)                      Linux Programmer's Manual                      SOCKET(2)

NAME
       socket - create an endpoint for communication

SYNOPSIS
       #include <sys/types.h>          /* See NOTES */
       #include <sys/socket.h>

       int socket(int domain, int type, int protocol);
```
常用domain有：
- AF_UNIX, AF_LOCAL: Local communication 
- AF_INET:  IPv4 Internet protocols
- AF_INET6: IPv6 Internet protocols

常用type有：
- SOCK_STREAM: 表示TCP
- SOCK_DGRAM: 表示UDP
- SOCK_RAW: 类似ICMP

查看支持的socket函数协议有哪些
```
# man protocols
```

```
# cat /etc/protocols 
# /etc/protocols:
# $Id: protocols,v 1.11 2011/05/03 14:45:40 ovasik Exp $
#
# Internet (IP) protocols
#
#       from: @(#)protocols     5.1 (Berkeley) 4/17/89
#
# Updated for NetBSD based on RFC 1340, Assigned Numbers (July 1992).
# Last IANA update included dated 2011-05-03
#
# See also http://www.iana.org/assignments/protocol-numbers

ip      0       IP              # internet protocol, pseudo protocol number
hopopt  0       HOPOPT          # hop-by-hop options for ipv6
icmp    1       ICMP            # internet control message protocol
igmp    2       IGMP            # internet group management protocol
ggp     3       GGP             # gateway-gateway protocol
ipv4    4       IPv4            # IPv4 encapsulation
st      5       ST              # ST datagram mode
tcp     6       TCP             # transmission control protocol
cbt     7       CBT             # CBT, Tony Ballardie <A.Ballardie@cs.ucl.ac.uk>
```

如下是跟性能相关的socket参数

#### 1.3.1 SO_LINGER

改变close行为
```
SO_LINGER
       Sets or gets the SO_LINGER option.  The argument is a linger structure.

           struct linger {
               int l_onoff;    /* linger active */
               int l_linger;   /* how many seconds to linger for */
           };
```
当l_onoff为1，l_linger为0，意味着client端发起close的时候，直接发rst包，不再等待WAIT状态。可以提升性能，避免系统上出现太多的FIN_WAIT，TIME_WAIT状态.
`/proc/sys/net/ipv4/tcp_max_tw_buckets`这个参数决定了内核维护多少个TIME_WAIT状态. 当然也可以通过调小tcp_max_tw_buckets的值来提升性能，如：
`echo 8192 > /proc/sys/net/ipv4/tcp_max_tw_buckets`

通过`man 7 socket`可以看到这些参数的

#### 1.3.2 SO_RCVBUF
 
socket buf接收缓存大小
```
# cat /proc/sys/net/core/rmem_default 
262144
# cat /proc/sys/net/core/rmem_max     
16777216
```
未设置SO_RCVBUF的话，使用rmem_default；设置SO_RCVBUF的话，比较SO_RCVBUF*2和rmem_max的值，取较小者作为SO_RCVBUF的值

#### 1.3.3 SO_SNDBUF 

socket buf发送缓存大小; 作用和SO_RCVBUF类似; 未设置SO_SNDBUF的话，使用wmem_default；
设置SO_SNDBUF的话，比较SO_SNDBUF*2和wmem_max的值，取较小者作为SO_SNDBUF的值

#### 1.3.4 SO_REUSEPORT

多个进程监听同一个端口(内核3.9特性)

注：`/proc/sys/net/core`这下面跟socket设置相关的参数

#### 1.3.5 listen - backlog

listen的backlog指的是三次握手过程进入EStablished状态之后未被accept处理完的队列长度，通过`man listen`可以看到函数说明；backlog参数会受到
`/proc/sys/net/core/somaxconn`影响，取较小者为准. 除了listen的backlog之外，还有syn backlog半连接队列：`/proc/sys/net/ipv4/tcp_max_syn_backlog`, 
最大半连接队列这个值一般不会设置得太大，当达到最大半连接队列后，可通过`echo 1 > /proc/sys/net/ipv4/tcp_syncookies`设置tcp_syncookies来优化，
实质是通过cpu换内存的方式，当最大半连接队列耗尽后，对后续的半连接进行哈希后存储起来.

#### 1.3.6 文件描述符

全局可打开最大文件描述符数量：`/proc/sys/fs/file-max`
单进程可打开最大文件描述符数量：`ulimit -n`

查看当前文件描述符使用情况
```
# cat /proc/sys/fs/file-nr  
2400    0       65535000
```
2400表示已用的文件描述符，65535000为总共可使用的文件描述符，0为可回收利用的文件描述符


TCP  面向可靠的连接

最大滑动窗口    拥塞控制算法

拥塞避免不好用

tc模拟一个大延时网络

## 内存

系统ps aux的RSS内存总和很小，free查看已耗尽内存了，消耗花在内核上？通过`slabtop`可以看到内核内存消耗情况
```
slabtop
```







