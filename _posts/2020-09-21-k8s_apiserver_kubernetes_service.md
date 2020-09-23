---
layout: post
title: K8s apiserver kubernetes service实现
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

K8s版本：v1.18.3

### 现象

访问k8s apiserver有集群内和集群外两种方式，集群外方式常见的是加载一个kubeconfig配置；集群内方式通过service account+rbac授权访问，走的是
default/kubernetes service来访问

default/kubernetes service是由apiserver来管理的，删除也是删除不掉的.
```
# kubectl get service kubernetes 
NAME         TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
kubernetes   ClusterIP   11.1.252.1   <none>        443/TCP   5h8m
 
# kubectl get endpoints kubernetes 
NAME         ENDPOINTS                                   AGE
kubernetes   192.168.104.111:6443,192.168.104.117:6443   5h8m
```

### 代码分析

#### bootstrap-controller

default命名空间下kubernetes service和kubernetes endpoint这块逻辑是由bootstrap-controller实现的;
bootstrap-controller是在InstallLegacyAPI阶段初始化的，由两个动作组成，一个是启动动作`PostStartHook`，另一个是停止动作`PreShutdownHook`
```
# k8s.io/kubernetes/cmd/kube-apiserver/app/server.go
Run -> CreateServerChain -> CreateKubeAPIServer -> kubeAPIServerConfig.Complete().New -> InstallLegacyAPI
```

```
// InstallLegacyAPI will install the legacy APIs for the restStorageProviders if they are enabled.
func (m *Master) InstallLegacyAPI(c *completedConfig, restOptionsGetter generic.RESTOptionsGetter, legacyRESTStorageProvider corerest.LegacyRESTStorageProvider) error {
    legacyRESTStorage, apiGroupInfo, err := legacyRESTStorageProvider.NewLegacyRESTStorage(restOptionsGetter)
    if err != nil {
        return fmt.Errorf("error building core storage: %v", err)
    }

    controllerName := "bootstrap-controller"
    coreClient := corev1client.NewForConfigOrDie(c.GenericConfig.LoopbackClientConfig)
    bootstrapController := c.NewBootstrapController(legacyRESTStorage, coreClient, coreClient, coreClient, coreClient.RESTClient())
    m.GenericAPIServer.AddPostStartHookOrDie(controllerName, bootstrapController.PostStartHook)
    m.GenericAPIServer.AddPreShutdownHookOrDie(controllerName, bootstrapController.PreShutdownHook)

    if err := m.GenericAPIServer.InstallLegacyAPIGroup(genericapiserver.DefaultLegacyAPIPrefix, &apiGroupInfo); err != nil {
        return fmt.Errorf("error in registering group versions: %v", err)
    }
    return nil
}
```

PostStartHook在prepared.Run中调用`RunPostStartHooks`启动，调用`RunPreShutdownHooks`停止；
prepared.Run函数是在CreateServerChain之后执行的
```
prepared.Run -> preparedGenericAPIServer.Run -> NonBlockingRun -> RunPostStartHooks
                                             |
                                             -> RunPreShutdownHooks 
```

#### PostStartHook

```
// PostStartHook initiates the core controller loops that must exist for bootstrapping.
func (c *Controller) PostStartHook(hookContext genericapiserver.PostStartHookContext) error {
    c.Start()
    return nil
}

// Start begins the core controller loops that must exist for bootstrapping
// a cluster.
func (c *Controller) Start() {
    if c.runner != nil {
        return
    }

    // Reconcile during first run removing itself until server is ready.
    endpointPorts := createEndpointPortSpec(c.PublicServicePort, "https", c.ExtraEndpointPorts)
    if err := c.EndpointReconciler.RemoveEndpoints(kubernetesServiceName, c.PublicIP, endpointPorts); err != nil {
        klog.Errorf("Unable to remove old endpoints from kubernetes service: %v", err)
    }

    // SecondaryServiceClusterIPRange为IPV6栈 
    repairClusterIPs := servicecontroller.NewRepair(c.ServiceClusterIPInterval, c.ServiceClient, c.EventClient, &c.ServiceClusterIPRange, c.ServiceClusterIPRegistry, &c.SecondaryServiceClusterIPRange, c.SecondaryServiceClusterIPRegistry)
    repairNodePorts := portallocatorcontroller.NewRepair(c.ServiceNodePortInterval, c.ServiceClient, c.EventClient, c.ServiceNodePortRange, c.ServiceNodePortRegistry)

    // run all of the controllers once prior to returning from Start.
    if err := repairClusterIPs.RunOnce(); err != nil {
        // If we fail to repair cluster IPs apiserver is useless. We should restart and retry.
        klog.Fatalf("Unable to perform initial IP allocation check: %v", err)
    }
    if err := repairNodePorts.RunOnce(); err != nil {
        // If we fail to repair node ports apiserver is useless. We should restart and retry.
        klog.Fatalf("Unable to perform initial service nodePort check: %v", err)
    }

    c.runner = async.NewRunner(c.RunKubernetesNamespaces, c.RunKubernetesService, repairClusterIPs.RunUntil, repairNodePorts.RunUntil)
    c.runner.Start()
}
```
PostStartHook执行的逻辑有：
1. 判断异步运行器是否运行，已运行就直接返回
2. 创建endpoint port列表
3. 首次运行的时候移除旧的endpoint, EndpointReconciler类型是leaseEndpointReconciler(在apiserver启动过程NewServerRunOptions定义）
4. repairClusterIPsk控制器确保所有ClusterIP独一无二分配
5. repairNodePorts控制器确保所有NodePort独一无二分配
6. 启动异步运行器，传入的参数是需要循环执行的函数，包含RunKubernetesNamespaces、RunKubernetesService、repairClusterIPs.RunUntil和repairNodePorts.RunUntil
    
一、RunKubernetesNamespaces函数每隔1分钟确保kube-system、kube-public和kube-node-lease命名空间存在
```
// RunKubernetesNamespaces periodically makes sure that all internal namespaces exist
func (c *Controller) RunKubernetesNamespaces(ch chan struct{}) {
    wait.Until(func() {
        // Loop the system namespace list, and create them if they do not exist
        for _, ns := range c.SystemNamespaces {
            if err := createNamespaceIfNeeded(c.NamespaceClient, ns); err != nil {
                runtime.HandleError(fmt.Errorf("unable to create required kubernetes system namespace %s: %v", ns, err))
            }
        }
    }, c.SystemNamespacesInterval, ch)
}
```

二、RunKubernetesServicez周期性更新kubernetes service
```
// RunKubernetesService periodically updates the kubernetes service
func (c *Controller) RunKubernetesService(ch chan struct{}) {
    // wait until process is ready
    // 健康检查
    wait.PollImmediateUntil(100*time.Millisecond, func() (bool, error) {
        var code int
        c.healthClient.Get().AbsPath("/healthz").Do(context.TODO()).StatusCode(&code)
        return code == http.StatusOK, nil
    }, ch)

    wait.NonSlidingUntil(func() {
        // Service definition is not reconciled after first
        // run, ports and type will be corrected only during
        // start.
        if err := c.UpdateKubernetesService(false); err != nil {
            runtime.HandleError(fmt.Errorf("unable to sync kubernetes service: %v", err))
        }
    }, c.EndpointInterval, ch)
}

// UpdateKubernetesService attempts to update the default Kube service.
func (c *Controller) UpdateKubernetesService(reconcile bool) error {
    // Update service & endpoint records.
    // TODO: when it becomes possible to change this stuff,
    // stop polling and start watching.
    // TODO: add endpoints of all replicas, not just the elected master.
    // 创建default命名空间
    if err := createNamespaceIfNeeded(c.NamespaceClient, metav1.NamespaceDefault); err != nil {
        return err
    }
    // kubernetes service port也可以用nodePort暴露，即指定--kubernetes-service-node-port参数即可
    servicePorts, serviceType := createPortAndServiceSpec(c.ServicePort, c.PublicServicePort, c.KubernetesServiceNodePort, "https", c.ExtraServicePorts)
    // 创建kubernetes service
    if err := c.CreateOrUpdateMasterServiceIfNeeded(kubernetesServiceName, c.ServiceIP, servicePorts, serviceType, reconcile); err != nil {
        return err
    }
    // c.PublicIP可以由--advertise-address指定
    endpointPorts := createEndpointPortSpec(c.PublicServicePort, "https", c.ExtraEndpointPorts)
    if err := c.EndpointReconciler.ReconcileEndpoints(kubernetesServiceName, c.PublicIP, endpointPorts, reconcile); err != nil {
        return err
    }
    return nil
}
```

c.EndpointReconciler类型是leaseEndpointReconciler
```
// ReconcileEndpoints lists keys in a special etcd directory.
// Each key is expected to have a TTL of R+n, where R is the refresh interval
// at which this function is called, and n is some small value.  If an
// apiserver goes down, it will fail to refresh its key's TTL and the key will
// expire. ReconcileEndpoints will notice that the endpoints object is
// different from the directory listing, and update the endpoints object
// accordingly.
func (r *leaseEndpointReconciler) ReconcileEndpoints(serviceName string, ip net.IP, endpointPorts []corev1.EndpointPort, reconcilePorts bool) error {
    r.reconcilingLock.Lock()
    defer r.reconcilingLock.Unlock()

    // 停止bootstra-controller的时候调用PreShutdownHook触发
    if r.stopReconcilingCalled {
        return nil
    }

    // Refresh the TTL on our key, independently of whether any error or
    // update conflict happens below. This makes sure that at least some of
    // the masters will add our endpoint.
    // 更新etcd中的lease信息，key结构形式:path.Join(s.baseKey, ip)，其中baseKey为"/masterleases/"
    if err := r.masterLeases.UpdateLease(ip.String()); err != nil {
        return err
    }

    return r.doReconcile(serviceName, endpointPorts, reconcilePorts)
}

func (r *leaseEndpointReconciler) doReconcile(serviceName string, endpointPorts []corev1.EndpointPort, reconcilePorts bool) error {
    // 获取endpoint
    e, err := r.epAdapter.Get(corev1.NamespaceDefault, serviceName, metav1.GetOptions{})
    shouldCreate := false
    if err != nil {
        if !errors.IsNotFound(err) {
            return err
        }
        // 是找不到该资源的话，就新建
        shouldCreate = true
        e = &corev1.Endpoints{
            ObjectMeta: metav1.ObjectMeta{
                Name:      serviceName,
                Namespace: corev1.NamespaceDefault,
            },
        }
    }

    // ... and the list of master IP keys from etcd
    // 从etcd中获取/masterleases/下所有apiserver的ip
    masterIPs, err := r.masterLeases.ListLeases()
    if err != nil {
        return err
    }

    // Since we just refreshed our own key, assume that zero endpoints
    // returned from storage indicates an issue or invalid state, and thus do
    // not update the endpoints list based on the result.
    if len(masterIPs) == 0 {
        return fmt.Errorf("no master IPs were listed in storage, refusing to erase all endpoints for the kubernetes service")
    }

    // Next, we compare the current list of endpoints with the list of master IP keys
    // 1. 检测endpoint中的subnet个数是否为1, 不为1，返回formatCorrect=false
    // 2. 对比endpoint中subnet Addresses和etcd中apiserver ip，不匹配的话返回ipsCorrect=false
    // 3. reconcilePorts为false, 返回portsCorrect=true
    formatCorrect, ipCorrect, portsCorrect := checkEndpointSubsetFormatWithLease(e, masterIPs, endpointPorts, reconcilePorts)
    if formatCorrect && ipCorrect && portsCorrect {
        // 如果都为true的话，确保生成对应的EndpointSlice
        return r.epAdapter.EnsureEndpointSliceFromEndpoints(corev1.NamespaceDefault, e)
    }

    // 如果formatCorrect为false, 清空Subsets
    if !formatCorrect {
        // Something is egregiously wrong, just re-make the endpoints record.
        e.Subsets = []corev1.EndpointSubset{{
            ......
        }}
    }
    // 如果formatCorrect或ipCorrect为false，以etcd中apiserver IP为准更新到endpoint subnets
    if !formatCorrect || !ipCorrect {
        // repopulate the addresses according to the expected IPs from etcd
        e.Subsets[0].Addresses = make([]corev1.EndpointAddress, len(masterIPs))
        for ind, ip := range masterIPs {
            e.Subsets[0].Addresses[ind] = corev1.EndpointAddress{IP: ip, NodeName: utilpointer.StringPtr(ip)}
        }

        // Lexicographic order is retained by this step.
        // 对EndpointSubset中Addresses、NotReadyAddresses、Ports进行归类，排序
        e.Subsets = endpointsv1.RepackSubsets(e.Subsets)
    }

    if !portsCorrect {
        // Reset ports.
        e.Subsets[0].Ports = endpointPorts
    }

    klog.Warningf("Resetting endpoints for master service %q to %v", serviceName, masterIPs)
    // 创建对应的endpoint
    if shouldCreate {
        if _, err = r.epAdapter.Create(corev1.NamespaceDefault, e); errors.IsAlreadyExists(err) {
            err = nil
        }
    } else {
        // 已存在，就更新
        _, err = r.epAdapter.Update(corev1.NamespaceDefault, e)
    }
    return err
}
```

三、repairClusterIPs.RunUntil, 确保所有ClusterIP独一无二分配

最终会调用到c.runOnce
```
repairClusterIPs.RunUntil -> c.RunOnce() -> c.runOnce
```

```
# k8s.io/kubernetes/pkg/registry/core/service/ipallocator/controller/repair.go

type Range struct {
    net *net.IPNet
    // base is a cached version of the start IP in the CIDR range as a *big.Int
    base *big.Int
    // max is the maximum size of the usable addresses in the range
    max int

    alloc allocator.Interface
}

// runOnce verifies the state of the cluster IP allocations and returns an error if an unrecoverable problem occurs.
func (c *Repair) runOnce() error {
    // TODO: (per smarterclayton) if Get() or ListServices() is a weak consistency read,
    // or if they are executed against different leaders,
    // the ordering guarantee required to ensure no IP is allocated twice is violated.
    // ListServices must return a ResourceVersion higher than the etcd index Get triggers,
    // and the release code must not release services that have had IPs allocated but not yet been created
    // See #8295

    // If etcd server is not running we should wait for some time and fail only then. This is particularly
    // important when we start apiserver and etcd at the same time.
    var snapshot *api.RangeAllocation
    var secondarySnapshot *api.RangeAllocation

    var stored, secondaryStored ipallocator.Interface
    var err, secondaryErr error

    err = wait.PollImmediate(time.Second, 10*time.Second, func() (bool, error) {
        var err error
        // 从etcd中获取已分配的ClusterCIDR
        snapshot, err = c.alloc.Get()
        if err != nil {
            return false, err
        }
        // 如果开启支持ipv6栈，并设置ipv6 cidr
        if c.shouldWorkOnSecondary() {
            // 从etcd中获取已分配的ipv6 ClusterCIDR
            secondarySnapshot, err = c.secondaryAlloc.Get()
            if err != nil {
                return false, err
            }
        }

        return true, nil
    })
    if err != nil {
        return fmt.Errorf("unable to refresh the service IP block: %v", err)
    }
    // If not yet initialized.
    if snapshot.Range == "" {
        // 赋值ServiceClusterIPRange
        snapshot.Range = c.network.String()
    }

    if c.shouldWorkOnSecondary() && secondarySnapshot.Range == "" {
        // 赋值SecondaryServiceClusterIPRange
        secondarySnapshot.Range = c.secondaryNetwork.String()
    }
    // Create an allocator because it is easy to use.
   
    // 从snapshot中计算网络段Range, 初始化ipv4地址分配器
    // Range is a contiguous block of IPs that can be allocated atomically.
    //
    // The internal structure of the range is:
    //
    //   For CIDR 10.0.0.0/24
    //   254 addresses usable out of 256 total (minus base and broadcast IPs)
    //     The number of usable addresses is r.max
    //
    //   CIDR base IP          CIDR broadcast IP
    //   10.0.0.0                     10.0.0.255
    //   |                                     |
    //   0 1 2 3 4 5 ...         ... 253 254 255
    //     |                              |
    //   r.base                     r.base + r.max
    //     |                              |
    //   offset #0 of r.allocated   last offset of r.allocated
    stored, err = ipallocator.NewFromSnapshot(snapshot)
    if c.shouldWorkOnSecondary() {
        // 从secondarySnapshot中计算ipv6网络段Range, 初始化ipv6地址分配器
        secondaryStored, secondaryErr = ipallocator.NewFromSnapshot(secondarySnapshot)
    }

    if err != nil || secondaryErr != nil {
        return fmt.Errorf("unable to rebuild allocator from snapshots: %v", err)
    }

    // We explicitly send no resource version, since the resource version
    // of 'snapshot' is from a different collection, it's not comparable to
    // the service collection. The caching layer keeps per-collection RVs,
    // and this is proper, since in theory the collections could be hosted
    // in separate etcd (or even non-etcd) instances.
    // 获取所有命名空间的service
    list, err := c.serviceClient.Services(metav1.NamespaceAll).List(context.TODO(), metav1.ListOptions{})
    if err != nil {
        return fmt.Errorf("unable to refresh the service IP block: %v", err)
    }

    var rebuilt, secondaryRebuilt *ipallocator.Range
    // 不再从snapshot计算range, 直接创建cidr range
    rebuilt, err = ipallocator.NewCIDRRange(c.network)
    if err != nil {
        return fmt.Errorf("unable to create CIDR range: %v", err)
    }

    if c.shouldWorkOnSecondary() {
        // 直接创建ipv6 cidr range
        secondaryRebuilt, err = ipallocator.NewCIDRRange(c.secondaryNetwork)
    }

    if err != nil {
        return fmt.Errorf("unable to create CIDR range: %v", err)
    }

    // Check every Service's ClusterIP, and rebuild the state as we think it should be.
    for _, svc := range list.Items {
        if !helper.IsServiceIPSet(&svc) {
            // 是否是有效的clusterIP
            // didn't need a cluster IP
            continue
        }
        ip := net.ParseIP(svc.Spec.ClusterIP)
        if ip == nil {
            // clusterIP解析失败
            // cluster IP is corrupt
            c.recorder.Eventf(&svc, v1.EventTypeWarning, "ClusterIPNotValid", "Cluster IP %s is not a valid IP; please recreate service", svc.Spec.ClusterIP)
            runtime.HandleError(fmt.Errorf("the cluster IP %s for service %s/%s is not a valid IP; please recreate", svc.Spec.ClusterIP, svc.Name, svc.Namespace))
            continue
        }

        // mark it as in-use
        // 根据ip选择ipv4或ipv6地址分配器
        actualAlloc := c.selectAllocForIP(ip, rebuilt, secondaryRebuilt)
        switch err := actualAlloc.Allocate(ip); err {
        case nil:
            actualStored := c.selectAllocForIP(ip, stored, secondaryStored)
            // 检查ip是否泄露
            if actualStored.Has(ip) {
                // remove it from the old set, so we can find leaks
                actualStored.Release(ip)
            } else {
                // cluster IP doesn't seem to be allocated
                c.recorder.Eventf(&svc, v1.EventTypeWarning, "ClusterIPNotAllocated", "Cluster IP %s is not allocated; repairing", ip)
                runtime.HandleError(fmt.Errorf("the cluster IP %s for service %s/%s is not allocated; repairing", ip, svc.Name, svc.Namespace))
            }
            delete(c.leaks, ip.String()) // it is used, so it can't be leaked
        // 检查ip是否重复
        case ipallocator.ErrAllocated:
            // cluster IP is duplicate
            c.recorder.Eventf(&svc, v1.EventTypeWarning, "ClusterIPAlreadyAllocated", "Cluster IP %s was assigned to multiple services; please recreate service", ip)
            runtime.HandleError(fmt.Errorf("the cluster IP %s for service %s/%s was assigned to multiple services; please recreate", ip, svc.Name, svc.Namespace))
        // 检查ip是否超出范围
        case err.(*ipallocator.ErrNotInRange):
            // cluster IP is out of range
            c.recorder.Eventf(&svc, v1.EventTypeWarning, "ClusterIPOutOfRange", "Cluster IP %s is not within the service CIDR %s; please recreate service", ip, c.network)
            runtime.HandleError(fmt.Errorf("the cluster IP %s for service %s/%s is not within the service CIDR %s; please recreate", ip, svc.Name, svc.Namespace, c.network))
        // 检查ip是否分配完
        case ipallocator.ErrFull:
            // somehow we are out of IPs
            cidr := actualAlloc.CIDR()
            c.recorder.Eventf(&svc, v1.EventTypeWarning, "ServiceCIDRFull", "Service CIDR %v is full; you must widen the CIDR in order to create new services", cidr)
            return fmt.Errorf("the service CIDR %v is full; you must widen the CIDR in order to create new services", cidr)
        default:
            c.recorder.Eventf(&svc, v1.EventTypeWarning, "UnknownError", "Unable to allocate cluster IP %s due to an unknown error", ip)
            return fmt.Errorf("unable to allocate cluster IP %s for service %s/%s due to an unknown error, exiting: %v", ip, svc.Name, svc.Namespace, err)
        }
    }
    // 再次检查是否有ip泄露
    c.checkLeaked(stored, rebuilt)
    if c.shouldWorkOnSecondary() {
        c.checkLeaked(secondaryStored, secondaryRebuilt)
    }

    // 更新etcd中的快照
    // Blast the rebuilt state into storage.
    err = c.saveSnapShot(rebuilt, c.alloc, snapshot)
    if err != nil {
        return err
    }

    if c.shouldWorkOnSecondary() {
        err := c.saveSnapShot(secondaryRebuilt, c.secondaryAlloc, secondarySnapshot)
        if err != nil {
            return nil
        }
    }
    return nil
}
```


四、repairNodePorts.RunUntil
```
repairNodePorts.RunUntil -> c.RunOnce() -> c.runOnce
```
最终会调用到`c.runOnce`

```
// runOnce verifies the state of the port allocations and returns an error if an unrecoverable problem occurs.
func (c *Repair) runOnce() error {
    // TODO: (per smarterclayton) if Get() or ListServices() is a weak consistency read,
    // or if they are executed against different leaders,
    // the ordering guarantee required to ensure no port is allocated twice is violated.
    // ListServices must return a ResourceVersion higher than the etcd index Get triggers,
    // and the release code must not release services that have had ports allocated but not yet been created
    // See #8295

    // If etcd server is not running we should wait for some time and fail only then. This is particularly
    // important when we start apiserver and etcd at the same time.
    var snapshot *api.RangeAllocation

    // 从etcd中获取快照
    err := wait.PollImmediate(time.Second, 10*time.Second, func() (bool, error) {
        var err error
        snapshot, err = c.alloc.Get()
        return err == nil, err
    })
    if err != nil {
        return fmt.Errorf("unable to refresh the port allocations: %v", err)
    }
    // If not yet initialized.
    if snapshot.Range == "" {
        snapshot.Range = c.portRange.String()
    }
    // Create an allocator because it is easy to use.
    // 根据获取端口分配范围
    stored, err := portallocator.NewFromSnapshot(snapshot)
    if err != nil {
        return fmt.Errorf("unable to rebuild allocator from snapshot: %v", err)
    }

    // We explicitly send no resource version, since the resource version
    // of 'snapshot' is from a different collection, it's not comparable to
    // the service collection. The caching layer keeps per-collection RVs,
    // and this is proper, since in theory the collections could be hosted
    // in separate etcd (or even non-etcd) instances.
    // 获取所有命名空间的service
    list, err := c.serviceClient.Services(metav1.NamespaceAll).List(context.TODO(), metav1.ListOptions{})
    if err != nil {
        return fmt.Errorf("unable to refresh the port block: %v", err)
    }

    // 直接创建PortAllocator对象
    rebuilt, err := portallocator.NewPortAllocator(c.portRange)
    if err != nil {
        return fmt.Errorf("unable to create port allocator: %v", err)
    }
    // Check every Service's ports, and rebuild the state as we think it should be.
    for i := range list.Items {
        svc := &list.Items[i]
        ports := collectServiceNodePorts(svc)
        if len(ports) == 0 {
            continue
        }

        for _, port := range ports {
            switch err := rebuilt.Allocate(port); err {
            // 检查是否有端口泄露
            case nil:
                if stored.Has(port) {
                    // remove it from the old set, so we can find leaks
                    stored.Release(port)
                } else {
                    // doesn't seem to be allocated
                    c.recorder.Eventf(svc, corev1.EventTypeWarning, "PortNotAllocated", "Port %d is not allocated; repairing", port)
                    runtime.HandleError(fmt.Errorf("the node port %d for service %s/%s is not allocated; repairing", port, svc.Name, svc.Namespace))
                }
                delete(c.leaks, port) // it is used, so it can't be leaked
            // 检查是否端口重复
            case portallocator.ErrAllocated:
                // port is duplicate, reallocate
                c.recorder.Eventf(svc, corev1.EventTypeWarning, "PortAlreadyAllocated", "Port %d was assigned to multiple services; please recreate service", port)
                runtime.HandleError(fmt.Errorf("the node port %d for service %s/%s was assigned to multiple services; please recreate", port, svc.Name, svc.Namespace))
            // 检查是否端口超出范围
            case err.(*portallocator.ErrNotInRange):
                // port is out of range, reallocate
                c.recorder.Eventf(svc, corev1.EventTypeWarning, "PortOutOfRange", "Port %d is not within the port range %s; please recreate service", port, c.portRange)
                runtime.HandleError(fmt.Errorf("the port %d for service %s/%s is not within the port range %s; please recreate", port, svc.Name, svc.Namespace, c.portRange))
            // 检查是否端口分配完了
            case portallocator.ErrFull:
                // somehow we are out of ports
                c.recorder.Eventf(svc, corev1.EventTypeWarning, "PortRangeFull", "Port range %s is full; you must widen the port range in order to create new services", c.portRange)
                return fmt.Errorf("the port range %s is full; you must widen the port range in order to create new services", c.portRange)
            default:
                c.recorder.Eventf(svc, corev1.EventTypeWarning, "UnknownError", "Unable to allocate port %d due to an unknown error", port)
                return fmt.Errorf("unable to allocate port %d for service %s/%s due to an unknown error, exiting: %v", port, svc.Name, svc.Namespace, err)
            }
        }
    }

    // Check for ports that are left in the old set.  They appear to have been leaked.
    // 检查是否端口泄露
    stored.ForEach(func(port int) {
        count, found := c.leaks[port]
        switch {
        case !found:
            // flag it to be cleaned up after any races (hopefully) are gone
            runtime.HandleError(fmt.Errorf("the node port %d may have leaked: flagging for later clean up", port))
            count = numRepairsBeforeLeakCleanup - 1
            fallthrough
        case count > 0:
            // pretend it is still in use until count expires
            c.leaks[port] = count - 1
            if err := rebuilt.Allocate(port); err != nil {
                runtime.HandleError(fmt.Errorf("the node port %d may have leaked, but can not be allocated: %v", port, err))
            }
        default:
            // do not add it to the rebuilt set, which means it will be available for reuse
            runtime.HandleError(fmt.Errorf("the node port %d appears to have leaked: cleaning up", port))
        }
    })

    // Blast the rebuilt state into storage.
    // 更新etcd中的快照
    if err := rebuilt.Snapshot(snapshot); err != nil {
        return fmt.Errorf("unable to snapshot the updated port allocations: %v", err)
    }

    if err := c.alloc.CreateOrUpdate(snapshot); err != nil {
        if errors.IsConflict(err) {
            return err
        }
        return fmt.Errorf("unable to persist the updated port allocations: %v", err)
    }
    return nil
}
```

#### PreShutdownHook

```
// PreShutdownHook triggers the actions needed to shut down the API Server cleanly.
func (c *Controller) PreShutdownHook() error {
    c.Stop()
    return nil
}

// Stop cleans up this API Servers endpoint reconciliation leases so another master can take over more quickly.
func (c *Controller) Stop() {
    // 
    if c.runner != nil {
        c.runner.Stop()
    }
    endpointPorts := createEndpointPortSpec(c.PublicServicePort, "https", c.ExtraEndpointPorts)
    finishedReconciling := make(chan struct{})
    go func() {
        defer close(finishedReconciling)
        klog.Infof("Shutting down kubernetes service endpoint reconciler")
        c.EndpointReconciler.StopReconciling()
        // 移除对应的endpoint
        if err := c.EndpointReconciler.RemoveEndpoints(kubernetesServiceName, c.PublicIP, endpointPorts); err != nil {
            klog.Error(err)
        }
    }()

    select {
    case <-finishedReconciling:
        // done
    case <-time.After(2 * c.EndpointInterval):
        // don't block server shutdown forever if we can't reach etcd to remove ourselves
        klog.Warning("RemoveEndpoints() timed out")
    }
}
```
