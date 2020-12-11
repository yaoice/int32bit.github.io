---
layout: post
title: k8s网络开发
subtitle: Galaxy NetworkPolicy Controller实现
catalog: true
tags:
     - k8s
---

### NetworkPolicy简介

>如果要在IP地址或端口级别（OSI第3层或第4层）控制流量，则可以考虑对集群中的特定应用程序使用Kubernetes NetworkPolicies。 NetworkPolicies是一种以应用程序为中心的构造，
>可指定如何允许Pod与各种网络“实体”进行通信（此处使用“实体”一词是为了避免使“端点”和“服务”等更常见的术语过载。具有特定的Kubernetes含义）。

>Pod可以与之通信的实体通过以下3个标识符的组合来标识：

- 允许的其他Pod（例外：Pod无法阻止对其自身的访问）
- 允许的命名空间
- IP块（例外：始终允许往返运行Pod的节点的流量，无论Pod或节点的IP地址如何）

>在定义基于Pod或基于命名空间的NetworkPolicy时，可以使用选择器来指定允许与该选择器匹配的Pod进出哪些流量。

>同时，在创建基于IP的NetworkPolicies时，我们基于IP块（CIDR范围）定义策略。

### Galaxy network policy原理

network policy的具体实现依赖cni插件，TKEStack galaxy支持network policy功能

>Kubernetes网络策略是pod级别的策略，基于这个原因，可能无法通过VXLAN等网络协议来实现网络策略。
>但是iptables很适合用于包过滤，基于iptables与ipset的组合设计来实现，ipset可以批量更新iptables。

以下图片来自[TKEStack galaxy](https://github.com/tkestack/galaxy/blob/master/doc/network-policy.md)

NetworkPolic映射为对应的ipset规则

<img src="/img/posts/2020-09-15/network_policy_ipset.png"/>

- ipset hash:ip用于匹配namespaceSelector和podSelector
- ipset hash:net用于匹配ipBlock，ipset支持nomatch选项以用于服务器以外的情况
- ports，我们可以使用多端口iptables扩展名将相同的协议端口设为单个iptables规则

cni网络中如果没有bridge，网络策略ingress和egress对应的iptables位置

ingress规则对应的iptables, 作用在filter表的forward和output链

<img src="/img/posts/2020-09-15/ingress_iptables.png"/>

egress规则对应的iptables，作用在filter表的forward和input链

<img src="/img/posts/2020-09-15/egress_iptables.png"/>

下面的图会看到为什么要禁用bridge-nf-call-iptables

### 禁用bridge-nf-call-iptables

netfilter实际上既可以过滤L3层的包，也可以过滤L2层的包；如下图所示：

<img src="/img/posts/2020-09-15/bridge_nfs_call_iptables.png"/>

通过参数设置可以让iptables不对bridge的包进行过滤, 禁用net.bridge.bridge-nf-call-iptables和net.bridge.bridge-nf-call-ip6tables
```
# cat >> /etc/sysctl.conf <<EOF
  net.bridge.bridge-nf-call-ip6tables = 0
  net.bridge.bridge-nf-call-iptables = 0
  net.bridge.bridge-nf-call-arptables = 0
  EOF
# sysctl -p /etc/sysctl.conf
```

或者改用下面的方法解决：
```
iptables -t raw -I PREROUTING -i BRIDGE -s x.x.x.x -j NOTRACK
```

### 代码分析

#### PolicyManager结构体
```
// PolicyManager implements kubernetes network policy for pods
// iptable ingress chain topology is like
//  FORWARD            GLX-POD-XXXX - GLX-PLCY-XXXX
//        \           /            \ /
//         GLX-INGRESS             /\
//        /           \           /  \
//  OUTPUT             GLX-POD-XXXX - GLX-PLCY-XXXX

// iptable egress chain topology is like
//  FORWARD            GLX-POD-XXXX - GLX-PLCY-XXXX
//        \           /            \ /
//         GLX-EGRESS              /\
//        /           \           /  \
//  INPUT             GLX-POD-XXXX - GLX-PLCY-XXXX
type PolicyManager struct {
    // 互斥锁
    sync.Mutex
    // 存放networkPolicy的规则
    policies           []policy
    // k8s clientSet
    client             kubernetes.Interface
    // ipset工具库
    ipsetHandle        ipset.Interface
    // iptables工具库
    iptableHandle      utiliptables.Interface
    hostName           string
    // 获取单例
    podInformerOnce    sync.Once
    // pod informer
    podCachedInformer  cache.SharedIndexInformer
    // pod informer的工厂
    podInformerFactory informers.SharedInformerFactory
    // to list pod
    podLister          corev1Lister.PodLister
    // to list namespace
    namespaceLister    corev1Lister.NamespaceLister
    // to list networkPolicy
    policyLister       networkingv1Lister.NetworkPolicyLister
    // context上下文
    ctx                context.Context
    quitChan           <-chan struct{}
}

type policy struct {
    ingressRule *ingressRule
    egressRule  *egressRule
    np          *networkv1.NetworkPolicy
}

type ingressRule struct {
    srcRules   []rule
    dstIPTable *ipsetTable
}

type egressRule struct {
    dstRules   []rule
    srcIPTable *ipsetTable
}

type rule struct {
    ipTable, netTable *ipsetTable
    tcpPorts          []string
    udpPorts          []string
}

type ipsetTable struct {
    ipset.IPSet
    entries []ipset.Entry
}
```

#### controller主处理逻辑

Galaxy network policy核心代码
```
func NewPolicyManager(
    client kubernetes.Interface,
    networkPolicyInformer networkingformers.NetworkPolicyInformer,
    quitChan <-chan struct{}) *PolicyManager {
    // 初始化PolicyManager对象
    pm := &PolicyManager{
        client:        client,
        ipsetHandle:   ipset.New(utilexec.New()),
        iptableHandle: utiliptables.New(utilexec.New(), utildbus.New(), utiliptables.ProtocolIpv4),
        hostName:      k8s.GetHostname(),
        ctx:           context.Background(),
        quitChan:      quitChan,
    }
    pm.initInformers(networkPolicyInformer)
    return pm
}

func (p *PolicyManager) initInformers(networkPolicyInformer networkingformers.NetworkPolicyInformer) {
    //podInformerFactory := informers.NewFilteredSharedInformerFactory(g.client, time.Minute, v1.NamespaceAll,
    //func(listOptions *v1.ListOptions) {
    //	listOptions.FieldSelector = fields.OneTermEqualSelector("spec.nodeName", k8s.GetHostname("")).String()
    //})
    p.podInformerFactory = informers.NewSharedInformerFactory(p.client, 0)
    podInformer := p.podInformerFactory.Core().V1().Pods()
    p.podCachedInformer = podInformer.Informer()
    p.podLister = podInformer.Lister()
    podEventHandler := eventhandler.NewPodEventHandler(p)
    policyHandler := eventhandler.NewNetworkPolicyEventHandler(p)
    p.podCachedInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
        AddFunc:    podEventHandler.OnAdd,
        UpdateFunc: podEventHandler.OnUpdate,
        DeleteFunc: podEventHandler.OnDelete,
    })
    networkPolicyInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
        AddFunc:    policyHandler.OnAdd,
        UpdateFunc: policyHandler.OnUpdate,
        DeleteFunc: policyHandler.OnDelete,
    })
    p.policyLister = networkPolicyInformer.Lister()
}
```
实际上network policy实现也是一个controller，监听的是pod/networkPolicy对象的add/update/delete事件

controller主处理函数
```
func (p *PolicyManager) Run() {
    glog.Infof("start resyncing network policies")
    // 1. 同步集群中所有的networkPolicy规则
    p.syncNetworkPolices()
    // 2. 同步GLX-sip-xxxx/GLX-snet-xxxx/GLX-dip-xxxx/GLX-dnet-xxxx/GLX-ip-xxxx ipsets规则，GLX-PLCY-XXXX iptables链规则
    p.syncNetworkPolicyRules()
    // 3. 同步GLX-INGRESS/GLX-EGRESS/GLX-POD-XXXX iptable链规则
    p.syncPods()
}
```

#### syncNetworkPolices

```
func (p *PolicyManager) syncNetworkPolices() {
    // 获取所有的NetworkPolicies
    list, err := p.policyLister.NetworkPolicies(v1.NamespaceAll).List(labels.Everything())
    if err != nil {
        glog.Warningf("failed to list network policies: %v", err)
        return
    }
    // 同步所有pod的开销很大，所以存在NetworkPolicie的话才执行这个步骤
    if len(list) > 0 {
        // 同步所有pod
        p.startPodInformerFactory()
    }
    var (
        policies []policy
    )
    for i := range list {
        // 解析NetworkPolicy中的ingress和egress
        ingress, egress, err := p.policyResult(list[i])
        if err != nil {
            glog.Warning(err)
            continue
        }
        policies = append(policies, policy{ingressRule: ingress, egressRule: egress, np: list[i]})
    }
    p.Lock()
    // 初始化policies
    p.policies = policies
    p.Unlock()
}
```

```
// It's expensive to sync all pods. So don't start podInformerFactory until there is any network policy object
func (p *PolicyManager) startPodInformerFactory() {
    p.podInformerOnce.Do(func() {
        glog.Infof("starting pod informer factory")
        defer glog.Infof("started pod informer factory")
        namespaceInformer := p.podInformerFactory.Core().V1().Namespaces()
        namespaceCachedInformer := namespaceInformer.Informer()
        p.namespaceLister = namespaceInformer.Lister()
        // 启动所有已注册的pod informer
        p.podInformerFactory.Start(p.quitChan)
        // wait for syncing pods
        // 等待所有pod/namespace同步完成
        _ = wait.PollInfinite(time.Second, func() (done bool, err error) {
            return p.podCachedInformer.HasSynced() && namespaceCachedInformer.HasSynced(), nil
        })
    })
}
```

#### syncNetworkPolicyRules

```
func (p *PolicyManager) syncNetworkPolicyRules() {
    var policies []policy
    p.Lock()
    policies = p.policies
    p.Unlock()
    if err := p.syncRules(policies); err != nil {
        glog.Warningf("failed to sync policy rules: %v", err)
    }
}

// syncRules ensures GLX-sip-xxxx/GLX-snet-xxxx/GLX-dip-xxxx/GLX-dnet-xxxx/GLX-ip-xxxx ipsets including their
// entries are expected, and GLX-PLCY-XXXX iptables chain are expected.
func (p *PolicyManager) syncRules(polices []policy) error {
    // sync ipsets
    // 获取所有ipset规则
    ipsets, err := p.ipsetHandle.ListSets()
    if err != nil {
        return fmt.Errorf("failed to list ipsets: %v", err)
    }
    // build new ipset table map
    // ipsetMap的数据结构：map[string]*ipsetTable
    // 构建ipset表名映射ipset表的map
    newIPSetMap := initIPSetMap(polices)

    // create ipset
    // 创建相应的ipset规则
    if err := p.createIPSet(newIPSetMap); err != nil {
        return err
    }
    // nolint: errcheck
    // ipset垃圾规则回收
    defer func() {
        // clean up stale ipsets after iptables referencing these ipsets are deleted
        for _, name := range ipsets {
            if !strings.HasPrefix(name, NamePrefix) {
                continue
            }
            if _, exist := newIPSetMap[name]; !exist {
                p.ipsetHandle.DestroySet(name)
            }
        }
    }()

    // sync iptables
    // 创建相应的iptables规则
    return p.syncIptables(polices)
}
```

#### syncPods

```
func (p *PolicyManager) syncPods() {
    glog.V(4).Infof("start syncing pods")
    var wg sync.WaitGroup
    // 同步pod iptables链的函数
    syncPodChains := func(pod *corev1.Pod) {
        defer wg.Done()
        // 同步GLX-INGRESS/GLX-EGRESS/GLX-POD-XXXX iptable链规则
        if err := p.SyncPodChains(pod); err != nil {
            glog.Warningf("failed to sync pod policy %s_%s: %v", pod.Name, pod.Namespace, err)
        }
    }
    // pod informer cache已经同步的话
    if p.podCachedInformer.HasSynced() {
        // 获取所有pod
        pods, err := p.podLister.Pods(v1.NamespaceAll).List(labels.Everything())
        if err != nil {
            glog.Warningf("failed to list pods: %v", err)
            return
        }
        // 获取nodeName
        nodeHostName := k8s.GetHostname()
        glog.V(4).Infof("find %d pods, nodeHostName %s", len(pods), nodeHostName)
        for i := range pods {
            // 遍历匹配nodeName过滤
            if pods[i].Spec.NodeName != nodeHostName {
                continue
            }
            wg.Add(1)
            glog.V(4).Infof("starting goroutine to sync pod chain for %s_%s", pods[i].Name, pods[i].Namespace)
            // 调用syncPodChains
            go syncPodChains(pods[i])
        }
    } else {
        // pod informer cache未同步的话
        // PodInformerFactory not started meaning there isn't any network policy right now, ensure pods' chains
        // are deleted
        // 调用apiserver直接过滤字段获取其节点下的所有pod
        list, err := p.client.CoreV1().Pods(v1.NamespaceAll).List(p.ctx, v1.ListOptions{
            FieldSelector: fields.OneTermEqualSelector("spec.nodeName", k8s.GetHostname()).String()})
        if err != nil {
            glog.Warningf("failed to list pods: %v", err)
            return
        }
        glog.V(4).Infof("find %d pods", len(list.Items))
        for i := range list.Items {
            wg.Add(1)
            // 调用syncPodChains 
            go syncPodChains(&list.Items[i])
        }
    }
    wg.Wait()
}
```

### 调试iptables

raw表在iptables规则中优先级最高，流入流量经过的第一个点是raw表的prerouting链，流出流量经过的第一个点是raw表的output链表.
在raw表中支持一个特殊的目标:TRACE，使内核记录下每条匹配该包的对应iptables规则信息。使用raw表内的TRACE target即可实现对iptables规则的跟踪调试。

#### 模拟操作

调试ipv4 icmp报文，并进行日志的采集
```
# iptables -t raw -A PREROUTING -p icmp -j TRACE
# iptables -t raw -A OUTPUT -p icmp -j TRACE
```

加载iptables日志模块
```
# modprobe nf_log_ipv4
# sysctl net.netfilter.nf_log.2
net.netfilter.nf_log.2 = nf_log_ipv4
```
为NONE的话就是加载失败

修改rsyslog日志配置
```
# vim /etc/rsyslog.conf
kern.*   /var/log/iptables.log

# service rsyslog restart
```

ping其它节点的ip
```
ping -c 1.1.1.1
```
如果/var/log/iptables.log下没有任何日志输出的话，继续编辑/etc/rsyslog.conf

>找到配置文件 /etc/rsyslog.conf
修改如下：
解注释：#$ModLoad imklog # reads kernel messages (the same are read from journald)
修改为：$ModLoad imklog # reads kernel messages (the same are read from journald)

>增加注释：$OmitLocalLogging on
修改为：#$OmitLocalLogging on

>增加注释：$IMJournalStateFile imjournal.state
修改为：#$IMJournalStateFile imjournal.state

再次查看，发现日志输出了
```
[root@global /var/log]# tailf /var/log/iptables.log 
Sep 28 21:57:16 [localhost] kernel: [66008088.172336] TRACE: raw:OUTPUT:policy:2 IN= OUT=eth1 SRC=2.2.2.2 DST=3.3.3.3 LEN=84 TOS=0x00 PREC=0x00 TTL=64 ID=18272 DF PROTO=ICMP TYPE=8 CODE=0 ID=3659 SEQ=11 UID=0 GID=0 
Sep 28 21:57:16 [localhost] kernel: [66008088.172348] TRACE: mangle:OUTPUT:policy:1 IN= OUT=eth1 SRC=2.2.2.2 DST=3.3.3.3 LEN=84 TOS=0x00 PREC=0x00 TTL=64 ID=18272 DF PROTO=ICMP TYPE=8 CODE=0 ID=3659 SEQ=11 UID=0 GID=0 
Sep 28 21:57:16 [localhost] kernel: [66008088.172354] TRACE: nat:OUTPUT:rule:1 IN= OUT=eth1 SRC=2.2.2.2 DST=3.3.3.3 LEN=84 TOS=0x00 PREC=0x00 TTL=64 ID=18272 DF PROTO=ICMP TYPE=8 CODE=0 ID=3659 SEQ=11 UID=0 GID=0 
Sep 28 21:57:16 [localhost] kernel: [66008088.172392] TRACE: nat:KUBE-SERVICES:return:22 IN= OUT=eth1 SRC=2.2.2.2 DST=3.3.3.3 LEN=84 TOS=0x00 PREC=0x00 TTL=64 ID=18272 DF PROTO=ICMP TYPE=8 CODE=0 ID=3659 SEQ=11 UID=0 GID=0 
Sep 28 21:57:16 [localhost] kernel: [66008088.172398] TRACE: nat:OUTPUT:policy:4 IN= OUT=eth1 SRC=2.2.2.2 DST=3.3.3.3 LEN=84 TOS=0x00 PREC=0x00 TTL=64 ID=18272 DF PROTO=ICMP TYPE=8 CODE=0 ID=3659 SEQ=11 UID=0 GID=0 
Sep 28 21:57:16 [localhost] kernel: [66008088.172405] TRACE: filter:OUTPUT:rule:1 IN= OUT=eth1 SRC=2.2.2.2 DST=3.3.3.3 LEN=84 TOS=0x00 PREC=0x00 TTL=64 ID=18272 DF PROTO=ICMP TYPE=8 CODE=0 ID=3659 SEQ=11 UID=0 GID=0 
Sep 28 21:57:16 [localhost] kernel: [66008088.172410] TRACE: filter:KUBE-FIREWALL:return:2 IN= OUT=eth1 SRC=2.2.2.2 DST=3.3.3.3 LEN=84 TOS=0x00 PREC=0x00 TTL=64 ID=18272 DF PROTO=ICMP TYPE=8 CODE=0 ID=3659 SEQ=11 UID=0 GID=0 
Sep 28 21:57:16 [localhost] kernel: [66008088.172415] TRACE: filter:OUTPUT:rule:2 IN= OUT=eth1 SRC=2.2.2.2 DST=3.3.3.3 LEN=84 TOS=0x00 PREC=0x00 TTL=64 ID=18272 DF PROTO=ICMP TYPE=8 CODE=0 ID=3659 SEQ=11 UID=0 GID=0 
Sep 28 21:57:16 [localhost] kernel: [66008088.172422] TRACE: filter:KUBE-SERVICES:return:1 IN= OUT=eth1 SRC=2.2.2.2 DST=3.3.3.3 LEN=84 TOS=0x00 PREC=0x00 TTL=64 ID=18272 DF PROTO=ICMP TYPE=8 CODE=0 ID=3659 SEQ=11 UID=0 GID=0 
Sep 28 21:57:16 [localhost] kernel: [66008088.172426] TRACE: filter:OUTPUT:rule:3 IN= OUT=eth1 SRC=2.2.2.2 DST=3.3.3.3 LEN=84 TOS=0x00 PREC=0x00 TTL=64 ID=18272 DF PROTO=ICMP TYPE=8 CODE=0 ID=3659 SEQ=11 UID=0 GID=0 
```

### 参考链接

- [https://github.com/tkestack/galaxy/blob/v1.0.4/doc/network-policy.md](https://github.com/tkestack/galaxy/blob/v1.0.4/doc/network-policy.md)
- [https://blog.csdn.net/tycoon1988/article/details/40826235](https://blog.csdn.net/tycoon1988/article/details/40826235)
- [https://www.frozentux.net/iptables-tutorial/cn/iptables-tutorial-cn-1.1.19.html](https://www.frozentux.net/iptables-tutorial/cn/iptables-tutorial-cn-1.1.19.html)
