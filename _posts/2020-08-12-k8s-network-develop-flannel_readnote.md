---
layout: post
title: k8s网络开发
subtitle: flannel源码阅读笔记
catalog: true
tags:
     - k8s
---

### 环境

flannel版本: v0.12.0

### 外部网卡获取

外部网卡结构体
```
type ExternalInterface struct {
    // 网卡属性
    Iface     *net.Interface
    // 对应网卡的内部IP
    IfaceAddr net.IP
    // 对应网卡的外部IP(类似浮动IP)
    ExtAddr   net.IP
}
```

主处理函数逻辑
```
    // Work out which interface to use
    var extIface *backend.ExternalInterface
    var err error
    // Check the default interface only if no interfaces are specified
    // 如果flannel启动程序没有指定网卡的话，即没有传入--iface或--iface-regex
    if len(opts.iface) == 0 && len(opts.ifaceRegex) == 0 {
        // --public-ip: 给其它节点内部访问用
        // 根据传入的--public-ip，匹配对应的网卡，外部IP=publicIP；
        // 如果没有--public-ip，则选择默认网关所在的网卡；外部IP=网卡IP
        extIface, err = LookupExtIface(opts.publicIP, "")
        if err != nil {
            log.Error("Failed to find any valid interface to use: ", err)
            os.Exit(1)
        }
    } else {
        // Check explicitly specified interfaces
        // 传入--iface参数，iface是一个string的slice
        for _, iface := range opts.iface {
            // 根据网卡名称匹配网卡, IP处理逻辑跟上面的一样
            extIface, err = LookupExtIface(iface, "")
            if err != nil {
                log.Infof("Could not find valid interface matching %s: %s", iface, err)
            }
            // 找到就退出循环
            if extIface != nil {
                break
            }
        }

        // Check interfaces that match any specified regexes
        if extIface == nil {
            // ifaceRegex也是一个string的slice, 可以定义正则表达式来匹配
            for _, ifaceRegex := range opts.ifaceRegex {
                // 正则表达式匹配两种场景，1. 先匹配IP  2. 如果没找到，再匹配网卡名
                extIface, err = LookupExtIface("", ifaceRegex)
                if err != nil {
                    log.Infof("Could not find valid interface matching %s: %s", ifaceRegex, err)
                }

                // 找到就退出循环
                if extIface != nil {
                    break
                }
            }
        }
        // 都没匹配到的话，退出程序
        if extIface == nil {
            // Exit if any of the specified interfaces do not match
            log.Error("Failed to find interface to use that matches the interfaces and/or regexes provided")
            os.Exit(1)
        }
    }
```

### 节点本地子网分配

网络配置结构体
```
type Config struct {
    Network     ip.IP4Net
    SubnetMin   ip.IP4
    SubnetMax   ip.IP4
    SubnetLen   uint
    BackendType string          `json:"-"`
    Backend     json.RawMessage `json:",omitempty"`
}
```

```
func ParseConfig(s string) (*Config, error) {
    cfg := new(Config)
    // 这里注意Config中的Network、SubnetMin、SubnetMax自定义了MarshalJSON和UnmarshalJSON函数
    // 例如："Network": "172.28.0.0/16", PrefixLen就是16
    err := json.Unmarshal([]byte(s), cfg)
    if err != nil {
        return nil, err
    }
    // 对SubnetLen和PrefixLen值的判断
    if cfg.SubnetLen > 0 {
        // SubnetLen needs to allow for a tunnel and bridge device on each host.
        if cfg.SubnetLen > 30 {
            return nil, errors.New("SubnetLen must be less than /31")
        }

        // SubnetLen needs to fit _more_ than twice into the Network.
        // the first subnet isn't used, so splitting into two one only provide one usable host.
        if cfg.SubnetLen < cfg.Network.PrefixLen+2 {
            return nil, errors.New("Network must be able to accommodate at least four subnets")
        }
    } else {
        // If the network is smaller than a /28 then the network isn't big enough for flannel so return an error.
        // Default to giving each host at least a /24 (as long as the network is big enough to support at least four hosts)
        // Otherwise, if the network is too small to give each host a /24 just split the network into four.
        if cfg.Network.PrefixLen > 28 {
            // Each subnet needs at least four addresses (/30) and the network needs to accommodate at least four
            // since the first subnet isn't used, so splitting into two would only provide one usable host.
            // So the min useful PrefixLen is /28
            return nil, errors.New("Network is too small. Minimum useful network prefix is /28")
        } else if cfg.Network.PrefixLen <= 22 {
            // Network is big enough to give each host a /24
            // prefix为22，统一子网长度为24
            cfg.SubnetLen = 24
        } else {
            // Use +2 to provide four hosts per subnet.
            // 22 < prefix <= 28时, 统一子网长度=prefix+2
            cfg.SubnetLen = cfg.Network.PrefixLen + 2
        }
    }
    // subnetSize = ip.IP4(1 << (32 - 24)) = 256
    subnetSize := ip.IP4(1 << (32 - cfg.SubnetLen))

    // 如果没有定义SubnetMin
    if cfg.SubnetMin == ip.IP4(0) {
        // skip over the first subnet otherwise it causes problems. e.g.
        // if Network is 10.100.0.0/16, having an interface with 10.0.0.0
        // conflicts with the broadcast address.
        // cfg.Network.IP = ParseIP4("172.28.0.0") = 2887516160
        cfg.SubnetMin = cfg.Network.IP + subnetSize
    } else if !cfg.Network.Contains(cfg.SubnetMin) {
        return nil, errors.New("SubnetMin is not in the range of the Network")
    }

    // 如果没有定义SubnetMax
    if cfg.SubnetMax == ip.IP4(0) {
        // cfg.Network.Next().IP = 2887516160 + (1<<16)
        cfg.SubnetMax = cfg.Network.Next().IP - subnetSize
    } else if !cfg.Network.Contains(cfg.SubnetMax) {
        return nil, errors.New("SubnetMax is not in the range of the Network")
    }

    // The SubnetMin and SubnetMax need to be aligned to a SubnetLen boundary
    // 255.255.255.0
    mask := ip.IP4(0xFFFFFFFF << (32 - cfg.SubnetLen))
    if cfg.SubnetMin != cfg.SubnetMin&mask {
        return nil, fmt.Errorf("SubnetMin is not on a SubnetLen boundary: %v", cfg.SubnetMin)
    }

    if cfg.SubnetMax != cfg.SubnetMax&mask {
        return nil, fmt.Errorf("SubnetMax is not on a SubnetLen boundary: %v", cfg.SubnetMax)
    }

    bt, err := parseBackendType(cfg.Backend)
    if err != nil {
        return nil, err
    }
    cfg.BackendType = bt

    return cfg, nil
}
```

等初始化完subnet管理器、backend管理器后，就把subnet配置信息写入本地文件
```
    if err := WriteSubnetFile(opts.subnetFile, config.Network, opts.ipMasq, bn); err != nil {
        // Continue, even though it failed.
        log.Warningf("Failed to write subnet file: %s", err)
    } else {
        log.Infof("Wrote subnet file to %s", opts.subnetFile)
    }
```

### 子网管理器

子网管理器有两种：一种是基于k8s实现的子网管理器，另一种是基于etcd实现的子网管理器

管理器的接口定义
```
type Manager interface {
    GetNetworkConfig(ctx context.Context) (*Config, error)
    AcquireLease(ctx context.Context, attrs *LeaseAttrs) (*Lease, error)
    RenewLease(ctx context.Context, lease *Lease) error
    WatchLease(ctx context.Context, sn ip.IP4Net, cursor interface{}) (LeaseWatchResult, error)
    WatchLeases(ctx context.Context, cursor interface{}) (LeaseWatchResult, error)

    Name() string
}
```

#### k8s子网管理器

```
type kubeSubnetManager struct {
    // 节点的annotaions记录子网分配信息
    annotations    annotations
    // k8s clientSet
    client         clientset.Interface
    // 节点名称
    nodeName       string
    // nodeLister
    nodeStore      listers.NodeLister
    // Controller实例
    nodeController cache.Controller
    // 子网配置
    subnetConf     *subnet.Config
    // Event channel，用于Backend类型与Controller之间通信
    events         chan subnet.Event
}
```

实际上这是一个监听Node事件的控制器, 估计是比较早期实现的，跟最新的sample-controller写法有异
```
func newKubeSubnetManager(c clientset.Interface, sc *subnet.Config, nodeName, prefix string) (*kubeSubnetManager, error) {
    var err error
    var ksm kubeSubnetManager
    // 初始化annotations对象，用于标注在K8s Node对象上
    ksm.annotations, err = newAnnotations(prefix)
    if err != nil {
        return nil, err
    }
    ksm.client = c
    ksm.nodeName = nodeName
    ksm.subnetConf = sc
    ksm.events = make(chan subnet.Event, 5000)
    // 初始化Indexer, Infromer对象
    indexer, controller := cache.NewIndexerInformer(
        // 定义List/Watch函数
        &cache.ListWatch{
            ListFunc: func(options metav1.ListOptions) (runtime.Object, error) {
                return ksm.client.CoreV1().Nodes().List(options)
            },
            WatchFunc: func(options metav1.ListOptions) (watch.Interface, error) {
                return ksm.client.CoreV1().Nodes().Watch(options)
            },
        },
        &v1.Node{},
        resyncPeriod,
        // Add/Delete/Update Node事件对应的回调处理函数
        cache.ResourceEventHandlerFuncs{
            AddFunc: func(obj interface{}) {
                ksm.handleAddLeaseEvent(subnet.EventAdded, obj)
            },
            UpdateFunc: ksm.handleUpdateLeaseEvent,
            DeleteFunc: func(obj interface{}) {
                node, isNode := obj.(*v1.Node)
                // We can get DeletedFinalStateUnknown instead of *api.Node here and we need to handle that correctly.
                if !isNode {
                    deletedState, ok := obj.(cache.DeletedFinalStateUnknown)
                    if !ok {
                        glog.Infof("Error received unexpected object: %v", obj)
                        return
                    }
                    node, ok = deletedState.Obj.(*v1.Node)
                    if !ok {
                        glog.Infof("Error deletedFinalStateUnknown contained non-Node object: %v", deletedState.Obj)
                        return
                    }
                    obj = node
                }
                ksm.handleAddLeaseEvent(subnet.EventRemoved, obj)
            },
        },
        cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc},
    )
    ksm.nodeController = controller
    ksm.nodeStore = listers.NewNodeLister(indexer)
    return &ksm, nil
}
```

Add/Update Node事件的处理函数逻辑差不多
```
func (ksm *kubeSubnetManager) handleAddLeaseEvent(et subnet.EventType, obj interface{}) {
    n := obj.(*v1.Node)
    // 校验节点annotations中flannel.alpha.coreos.com/kube-subnet-manager 
    if s, ok := n.Annotations[ksm.annotations.SubnetKubeManaged]; !ok || s != "true" {
        return
    }
    // 解析节点Node annotaions中的子网信息赋值给Lease对象
    l, err := ksm.nodeToLease(*n)
    if err != nil {
        glog.Infof("Error turning node %q to lease: %v", n.ObjectMeta.Name, err)
        return
    }
    // 塞到events channel中
    ksm.events <- subnet.Event{et, l}
}

func (ksm *kubeSubnetManager) handleUpdateLeaseEvent(oldObj, newObj interface{}) {
    o := oldObj.(*v1.Node)
    n := newObj.(*v1.Node)
    // 校验节点annotations中flannel.alpha.coreos.com/kube-subnet-manager
    if s, ok := n.Annotations[ksm.annotations.SubnetKubeManaged]; !ok || s != "true" {
        return
    }
    // 新旧Node对象的这些annotations是否一样
    if o.Annotations[ksm.annotations.BackendData] == n.Annotations[ksm.annotations.BackendData] &&
        o.Annotations[ksm.annotations.BackendType] == n.Annotations[ksm.annotations.BackendType] &&
        o.Annotations[ksm.annotations.BackendPublicIP] == n.Annotations[ksm.annotations.BackendPublicIP] {
        return // No change to lease
    }

    // 解析节点Node annotaions中的子网信息赋值给Lease对象
    l, err := ksm.nodeToLease(*n)
    if err != nil {
        glog.Infof("Error turning node %q to lease: %v", n.ObjectMeta.Name, err)
        return
    }
    // 塞到events channel中
    ksm.events <- subnet.Event{subnet.EventAdded, l}
}
```
在哪里从events channel取呢？ 在backend Manager那端获取，backend类型有：alivpc、alloc、awsvpc、extension、gce、hostgw、ipip、ipsec、udp、vxlan

每种backend类型在main启动函数开始时就进行了注册
```
    // Backends need to be imported for their init() to get executed and them to register
    "github.com/coreos/flannel/backend"
    _ "github.com/coreos/flannel/backend/alivpc"
    _ "github.com/coreos/flannel/backend/alloc"
    _ "github.com/coreos/flannel/backend/awsvpc"
    _ "github.com/coreos/flannel/backend/extension"
    _ "github.com/coreos/flannel/backend/gce"
    _ "github.com/coreos/flannel/backend/hostgw"
    _ "github.com/coreos/flannel/backend/ipip"
    _ "github.com/coreos/flannel/backend/ipsec"
    _ "github.com/coreos/flannel/backend/udp"
    _ "github.com/coreos/flannel/backend/vxlan"
```

```
// constructors维护backend类型名称->初始化backend对象函数的map结构
var constructors = make(map[string]BackendCtor)

// 注册函数
func Register(name string, ctor BackendCtor) {
    constructors[name] = ctor
}
```

以hostgw类型为例
```
// hostgw backend类型注册到constructors
func init() {
    backend.Register("host-gw", New)
}

// hostgw backend结构体定义
type HostgwBackend struct {
    // 子网管理器
    sm       subnet.Manager
    // 外部网卡属性
    extIface *backend.ExternalInterface
}

// 初始化hostgw Backend对象函数
func New(sm subnet.Manager, extIface *backend.ExternalInterface) (backend.Backend, error) {
    // 不支持映射IP场景
    if !extIface.ExtAddr.Equal(extIface.IfaceAddr) {
        return nil, fmt.Errorf("your PublicIP differs from interface IP, meaning that probably you're on a NAT, which is not supported by host-gw backend")
    }

    be := &HostgwBackend{
        sm:       sm,
        extIface: extIface,
    }
    return be, nil
}

// 每种backend类型都会调用RegisterNetwork这个函数, 每种类型都需要一个新的网络对象，比如操作静态路由、vxlan隧道、udp隧道、ipip隧道等；
// 这些网络对象抽象成一个公共接口Network，返回结果是一个实现了Network接口的对象
type Network interface {
    Lease() *subnet.Lease
    MTU() int
    Run(ctx context.Context)
}

func (be *HostgwBackend) RegisterNetwork(ctx context.Context, wg sync.WaitGroup, config *subnet.Config) (backend.Network, error) {
    // 初始化RouteNetwork对象
    n := &backend.RouteNetwork{
        SimpleNetwork: backend.SimpleNetwork{
            ExtIface: be.extIface,
        },
        SM:          be.sm,
        BackendType: "host-gw",
        Mtu:         be.extIface.Iface.MTU,
        LinkIndex:   be.extIface.Iface.Index,
    }
    // 获取路由的回调函数，就是到其它节点子网的静态路由
    n.GetRoute = func(lease *subnet.Lease) *netlink.Route {
        return &netlink.Route{
            // 租约节点的网段
            Dst:       lease.Subnet.ToIPNet(),
            // 租约节点的publicIP
            Gw:        lease.Attrs.PublicIP.ToIP(),
            // 本地的link
            LinkIndex: n.LinkIndex,
        }
    }
    // 初始化LeaseAttrs对象
    attrs := subnet.LeaseAttrs{
        PublicIP:    ip.FromIP(be.extIface.ExtAddr),
        BackendType: "host-gw",
    }
    // 获取租约节点的子网信息, 这里面主要有三个步骤
    // 1. 从nodeStore中根据节点名称获取Node对象, 深拷贝复制个新对象出来
    // 2. Patch节点的annotations, 把子网相关信息标注上
    // 3. 启动之初，标注网络不可用到Node Condition
    l, err := be.sm.AcquireLease(ctx, &attrs)
    switch err {
    case nil:
        // 正常赋值
        n.SubnetLease = l

    case context.Canceled, context.DeadlineExceeded:
        return nil, err

    default:
        return nil, fmt.Errorf("failed to acquire lease: %v", err)
    }

    return n, nil
}

// 继续调用实现了Network接口的对象的Run函数
func (n *RouteNetwork) Run(ctx context.Context) {
    wg := sync.WaitGroup{}

    log.Info("Watching for new subnet leases")
    // 初始化一个存放子网event类型的channel
    evts := make(chan []subnet.Event)
    wg.Add(1)
    go func() {
        // 监听节点租约变化
        subnet.WatchLeases(ctx, n.SM, n.SubnetLease, evts)
        wg.Done()
    }()

    // 路由相关在下面《hostgw模式生成路由》分析
    n.routes = make([]netlink.Route, 0, 10)
    wg.Add(1)
    go func() {
        n.routeCheck(ctx)
        wg.Done()
    }()

    defer wg.Wait()

    for {
        select {
        // 从evts channel取event
        case evtBatch := <-evts:
            // 处理event的函数，涉及路由的添加/删除
            n.handleSubnetEvents(evtBatch)

        case <-ctx.Done():
            return
        }
    }
}

// subnet.WatchLeases
func WatchLeases(ctx context.Context, sm Manager, ownLease *Lease, receiver chan []Event) {
    // 初始化一个leaseWatcher对象
    lw := &leaseWatcher{
        ownLease: ownLease,
    }
    var cursor interface{}

    for {
        // 假设subnetManager用的是KubeSubnetManager
        // 所以调用的是SubnetManager的WatchLeases, 尝试从events channnel中取出event
        res, err := sm.WatchLeases(ctx, cursor)
        if err != nil {
            if err == context.Canceled || err == context.DeadlineExceeded {
                return
            }

            log.Errorf("Watch subnets: %v", err)
            // 获取失败的话，间隔1秒继续尝试
            time.Sleep(time.Second)
            continue
        }
        // res.Cursor、res.Snapshot都不适用于KubeSubnetManager
        cursor = res.Cursor

        var batch []Event
        // 从evnets channel中取出event
        if len(res.Events) > 0 {
            // update函数处理两种event，一种是EventAdded，另一种是EventRemoved
            // EventAdded：leaseWatcher.leases新增这个event, 如果已存在就替换
            // EventRemoved：l = append(l[:i], l[i+1:]...)采用这种方式移除Event
            batch = lw.update(res.Events)
        } else {
            // 如果events channel中没有event的话
            // 1. 遍历lw.leases以EventRemoved事件添加到batch中, 把原先的路由都删掉？或者len(res.Events)压根不会为0？
            // 2. 清空lw.leases，以res.Snapshot赋值到lw.leases
            batch = lw.reset(res.Snapshot)
        }

        if len(batch) > 0 {
            // 写入receiver channel
            receiver <- batch
        }
    }
}
```

#### etcd子网管理器

```
// 初始化连接etcd的配置信息
cfg := &etcdv2.EtcdConfig{
        Endpoints: strings.Split(opts.etcdEndpoints, ","),
        Keyfile:   opts.etcdKeyfile,
        Certfile:  opts.etcdCertfile,
        CAFile:    opts.etcdCAFile,
        Prefix:    opts.etcdPrefix,
        Username:  opts.etcdUsername,
        Password:  opts.etcdPassword,
    }

    // Attempt to renew the lease for the subnet specified in the subnetFile
    // 获取先前的子网配置
    prevSubnet := ReadCIDRFromSubnetFile(opts.subnetFile, "FLANNEL_SUBNET")
    // 返回一个etcd Manager对象
    return etcdv2.NewLocalManager(cfg, prevSubnet)
```

etcd LocalManager结构体定义
```
type LocalManager struct {
    registry       Registry
    previousSubnet ip.IP4Net
}
```
内部还包含一个Registry内部接口定义

```
type Registry interface {
    getNetworkConfig(ctx context.Context) (string, error)
    getSubnets(ctx context.Context) ([]Lease, uint64, error)
    getSubnet(ctx context.Context, sn ip.IP4Net) (*Lease, uint64, error)
    createSubnet(ctx context.Context, sn ip.IP4Net, attrs *LeaseAttrs, ttl time.Duration) (time.Time, error)
    updateSubnet(ctx context.Context, sn ip.IP4Net, attrs *LeaseAttrs, ttl time.Duration, asof uint64) (time.Time, error)
    deleteSubnet(ctx context.Context, sn ip.IP4Net) error
    watchSubnets(ctx context.Context, since uint64) (Event, uint64, error)
    watchSubnet(ctx context.Context, since uint64, sn ip.IP4Net) (Event, uint64, error)
}
```
这些函数定义简化了操作etcd registry子网配置

### host-gw模式

```
New -> RegisterNetwork -> RouteNetwork.Run
```

更新路由的主要代码
```
    // 初始化routes slice
    n.routes = make([]netlink.Route, 0, 10)
    wg.Add(1)
    go func() {
        // 间隔10s检查下子网的路由是否存在，否则加上
        n.routeCheck(ctx)
        wg.Done()
    }()

    defer wg.Wait()

    for {
        select {
        case evtBatch := <-evts:
            // 处理事件的函数
            n.handleSubnetEvents(evtBatch)

        case <-ctx.Done():
            return
        }
    }
```

```
func (n *RouteNetwork) handleSubnetEvents(batch []subnet.Event) {
    // 遍历batch channel
    for _, evt := range batch {
        switch evt.Type {
        // 添加事件
        case subnet.EventAdded:
            log.Infof("Subnet added: %v via %v", evt.Lease.Subnet, evt.Lease.Attrs.PublicIP)
            // Backend类型判断
            if evt.Lease.Attrs.BackendType != n.BackendType {
                log.Warningf("Ignoring non-%v subnet: type=%v", n.BackendType, evt.Lease.Attrs.BackendType)
                continue
            }
            // 获取到其它节点子网的路由
            route := n.GetRoute(&evt.Lease)
            // 因为是添加事件，添加n.routes中的路由
            n.addToRouteList(*route)
            // Check if route exists before attempting to add it
            // 再次检查路由是否已存在
            routeList, err := netlink.RouteListFiltered(netlink.FAMILY_V4, &netlink.Route{Dst: route.Dst}, netlink.RT_FILTER_DST)
            if err != nil {
                log.Warningf("Unable to list routes: %v", err)
            }

            if len(routeList) > 0 && !routeEqual(routeList[0], *route) {
                // Same Dst different Gw or different link index. Remove it, correct route will be added below.
                log.Warningf("Replacing existing route to %v via %v dev index %d with %v via %v dev index %d.", evt.Lease.Subnet, routeList[0].Gw, routeList[0].LinkIndex, evt.Lease.Subnet, evt.Lease.Attrs.PublicIP, route.LinkIndex)
                if err := netlink.RouteDel(&routeList[0]); err != nil {
                    log.Errorf("Error deleting route to %v: %v", evt.Lease.Subnet, err)
                    continue
                }
                n.removeFromRouteList(routeList[0])
            }

            if len(routeList) > 0 && routeEqual(routeList[0], *route) {
                // Same Dst and same Gw, keep it and do not attempt to add it.
                log.Infof("Route to %v via %v dev index %d already exists, skipping.", evt.Lease.Subnet, evt.Lease.Attrs.PublicIP, routeList[0].LinkIndex)
            } else if err := netlink.RouteAdd(route); err != nil {
                log.Errorf("Error adding route to %v via %v dev index %d: %v", evt.Lease.Subnet, evt.Lease.Attrs.PublicIP, route.LinkIndex, err)
                continue
            }
        // 删除事件
        case subnet.EventRemoved:
            log.Info("Subnet removed: ", evt.Lease.Subnet)
            // Backend类型不匹配的话，跳过
            if evt.Lease.Attrs.BackendType != n.BackendType {
                log.Warningf("Ignoring non-%v subnet: type=%v", n.BackendType, evt.Lease.Attrs.BackendType)
                continue
            }
            // 获取到其它节点子网的路由
            route := n.GetRoute(&evt.Lease)
            // Always remove the route from the route list.
            // 因为是删除事件，删除n.routes中的路由
            n.removeFromRouteList(*route)
            // 因为是删除事件，所以删除宿主机上的路由
            if err := netlink.RouteDel(route); err != nil {
                log.Errorf("Error deleting route to %v: %v", evt.Lease.Subnet, err)
                continue
            }

        default:
            log.Error("Internal error: unknown event type: ", int(evt.Type))
        }
    }
}
```

### vxlan模式



### ipip模式



### 代码片段

网络开发可重复利用的代码片段
```
package ip

import (
    "errors"
    "fmt"
    "net"
    "syscall"

    "github.com/vishvananda/netlink"
)

// 获取网卡IP
func getIfaceAddrs(iface *net.Interface) ([]netlink.Addr, error) {
    link := &netlink.Device{
        netlink.LinkAttrs{
            Index: iface.Index,
        },
    }

    return netlink.AddrList(link, syscall.AF_INET)
}

// 获取网卡ipv4 IP
func GetIfaceIP4Addr(iface *net.Interface) (net.IP, error) {
    addrs, err := getIfaceAddrs(iface)
    if err != nil {
        return nil, err
    }

    // prefer non link-local addr
    var ll net.IP

    for _, addr := range addrs {
        if addr.IP.To4() == nil {
            continue
        }

        if addr.IP.IsGlobalUnicast() {
            return addr.IP, nil
        }

        if addr.IP.IsLinkLocalUnicast() {
            ll = addr.IP
        }
    }

    if ll != nil {
        // didn't find global but found link-local. it'll do.
        return ll, nil
    }

    return nil, errors.New("No IPv4 address found for given interface")
}

// 网卡IP匹配
func GetIfaceIP4AddrMatch(iface *net.Interface, matchAddr net.IP) error {
    addrs, err := getIfaceAddrs(iface)
    if err != nil {
        return err
    }

    for _, addr := range addrs {
        // Attempt to parse the address in CIDR notation
        // and assert it is IPv4
        if addr.IP.To4() != nil {
            if addr.IP.To4().Equal(matchAddr) {
                return nil
            }
        }
    }

    return errors.New("No IPv4 address found for given interface")
}

// 获取默认网关所在的网卡
func GetDefaultGatewayIface() (*net.Interface, error) {
    routes, err := netlink.RouteList(nil, syscall.AF_INET)
    if err != nil {
        return nil, err
    }

    for _, route := range routes {
        if route.Dst == nil || route.Dst.String() == "0.0.0.0/0" {
            if route.LinkIndex <= 0 {
                return nil, errors.New("Found default route but could not determine interface")
            }
            return net.InterfaceByIndex(route.LinkIndex)
        }
    }

    return nil, errors.New("Unable to find default route")
}

// 根据IP获取网卡
func GetInterfaceByIP(ip net.IP) (*net.Interface, error) {
    ifaces, err := net.Interfaces()
    if err != nil {
        return nil, err
    }

    for _, iface := range ifaces {
        err := GetIfaceIP4AddrMatch(&iface, ip)
        if err == nil {
            return &iface, nil
        }
    }

    return nil, errors.New("No interface with given IP found")
}

// 根据IP获取直连路由
func DirectRouting(ip net.IP) (bool, error) {
    routes, err := netlink.RouteGet(ip)
    if err != nil {
        return false, fmt.Errorf("couldn't lookup route to %v: %v", ip, err)
    }
    if len(routes) == 1 && routes[0].Gw == nil {
        // There is only a single route and there's no gateway (i.e. it's directly connected)
        return true, nil
    }
    return false, nil
}

// 确保Link设备是ipv4地址
// EnsureV4AddressOnLink ensures that there is only one v4 Addr on `link` and it equals `ipn`.
// If there exist multiple addresses on link, it returns an error message to tell callers to remove additional address.
func EnsureV4AddressOnLink(ipn IP4Net, link netlink.Link) error {
    addr := netlink.Addr{IPNet: ipn.ToIPNet()}
    existingAddrs, err := netlink.AddrList(link, netlink.FAMILY_V4)
    if err != nil {
        return err
    }

    // flannel will never make this happen. This situation can only be caused by a user, so get them to sort it out.
    if len(existingAddrs) > 1 {
        return fmt.Errorf("link has incompatible addresses. Remove additional addresses and try again. %#v", link)
    }

    // If the device has an incompatible address then delete it. This can happen if the lease changes for example.
    if len(existingAddrs) == 1 && !existingAddrs[0].Equal(addr) {
        if err := netlink.AddrDel(link, &existingAddrs[0]); err != nil {
            return fmt.Errorf("failed to remove IP address %s from %s: %s", ipn.String(), link.Attrs().Name, err)
        }
        existingAddrs = []netlink.Addr{}
    }

    // Actually add the desired address to the interface if needed.
    if len(existingAddrs) == 0 {
        if err := netlink.AddrAdd(link, &addr); err != nil {
            return fmt.Errorf("failed to add IP address %s to %s: %s", ipn.String(), link.Attrs().Name, err)
        }
    }

    return nil
}
```

### 参考链接

- [https://github.com/coreos/flannel](https://github.com/coreos/flannel)