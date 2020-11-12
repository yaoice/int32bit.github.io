---
layout: post
title: K8S device plugin学习笔记
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

- 系统：CentOS 7
- kernel: 3.10.0-862.el7.x86_64
- Kubernetes: v1.19.3

### 安装K8s

- [CentOS 7安装K8S](http://www.iceyao.com.cn/2017/12/05/Kubeadm%E5%AE%89%E8%A3%85Kubernetes1.8.4/)
- [Ubuntu 20安装K8S](http://www.iceyao.com.cn/2020/10/22/istio_install_note/)

### k8s device plugin

#### device plugin简介

>Kubernetes在v1.10版本引入了feature state beta功能的[device plugin机制](https://github.com/kubernetes/community/blob/master/contributors/design-proposals/resource-management/device-plugin.md)框架，
>您可以使用该框架将系统硬件资源发布到Kubelet。供应商可以为您手动部署或作为DaemonSet部署的设备插件，
>而不是为Kubernetes本身定制代码。目标设备包括GPU，
>高性能NIC，FPGA，InfiniBand适配器以及其他类似的计算资源，
>可能需要特定于供应商的初始化和设置。

#### device plugin工作原理

<img src="/img/posts/2020-11-11/device-plugin-overview.png"/>

#### 注册device plugin

kubelet暴露`Registration`的grpc服务, 提供注册device-plugin
```
//k8s.io/kubelet/pkg/apis/deviceplugin/v1beta1/api.proto
//注册device plugin的grpc接口声明

// Registration is the service advertised by the Kubelet
// Only when Kubelet answers with a success code to a Register Request
// may Device Plugins start their service
// Registration may fail when device plugin version is not supported by
// Kubelet or the registered resourceName is already taken by another
// active device plugin. Device plugin is expected to terminate upon registration failure
service Registration {
    rpc Register(RegisterRequest) returns (Empty) {}
}
```

注册一个device plugin需要传什么参数
```
message DevicePluginOptions {
        //是否需要在容器启动前调用
        // Indicates if PreStartContainer call is required before each container start
        bool pre_start_required = 1;
        //是否实现预分配
        // Indicates if GetPreferredAllocation is implemented and available for calling
        bool get_preferred_allocation_available = 2;
}

message RegisterRequest {
        //device plugin api版本号
        // Version of the API the Device Plugin was built against
        string version = 1;
        //device plugin监听的unix socket路径
        // Name of the unix socket the device plugin is listening on
        // PATH = path.Join(DevicePluginPath, endpoint)
        string endpoint = 2;
        //device plugin的资源名，形如：nvidia.com/gpu
        // Schedulable resource name. As of now it's expected to be a DNS Label
        string resource_name = 3;
        // Options to be communicated with Device Manager
        //其它开关选项
        DevicePluginOptions options = 4;
}
```

kubelet启动device-plugin manager的grpc server，监听grpc client来调用
```
// Start starts the Device Plugin Manager and start initialization of
// podDevices and allocatedDevices information from checkpointed state and
// starts device plugin registration service.
func (m *ManagerImpl) Start(activePods ActivePodsFunc, sourcesReady config.SourcesReady) error {
    klog.V(2).Infof("Starting Device Plugin manager")

    m.activePods = activePods
    m.sourcesReady = sourcesReady

    // Loads in allocatedDevices information from disk.
    err := m.readCheckpoint()
    if err != nil {
        klog.Warningf("Continue after failing to read checkpoint file. Device allocation info may NOT be up-to-date. Err: %v", err)
    }

    socketPath := filepath.Join(m.socketdir, m.socketname)
    if err = os.MkdirAll(m.socketdir, 0750); err != nil {
        return err
    }
    if selinux.SELinuxEnabled() {
        if err := selinux.SetFileLabel(m.socketdir, config.KubeletPluginsDirSELinuxLabel); err != nil {
            klog.Warningf("Unprivileged containerized plugins might not work. Could not set selinux context on %s: %v", m.socketdir, err)
        }
    }

    // Removes all stale sockets in m.socketdir. Device plugins can monitor
    // this and use it as a signal to re-register with the new Kubelet.
    if err := m.removeContents(m.socketdir); err != nil {
        klog.Errorf("Fail to clean up stale contents under %s: %v", m.socketdir, err)
    }

    s, err := net.Listen("unix", socketPath)
    if err != nil {
        klog.Errorf(errListenSocket+" %v", err)
        return err
    }

    m.wg.Add(1)
    m.server = grpc.NewServer([]grpc.ServerOption{}...)

    pluginapi.RegisterRegistrationServer(m.server, m)
    go func() {
        defer m.wg.Done()
        m.server.Serve(s)
    }()

    klog.V(2).Infof("Serving device plugin registration server on %q", socketPath)

    return nil
}
```

#### 开发device plugin

开发device plugin的过程一般有两个阶段：
1. 初始化阶段，在此阶段，device plugin将执行特定于供应商的初始化和设置，以确保设备处于就绪状态.
2. 启动阶段，插件启动grpc server服务，监听在宿主机`/var/lib/kubelet/device-plugins/`目录下unix socket，
并实现以下rpc接口定义

```
// DevicePlugin is the service advertised by Device Plugins
service DevicePlugin {
        // GetDevicePluginOptions returns options to be communicated with Device
        // Manager
        rpc GetDevicePluginOptions(Empty) returns (DevicePluginOptions) {}

        // ListAndWatch returns a stream of List of Devices
        // Whenever a Device state change or a Device disappears, ListAndWatch
        // returns the new list
        rpc ListAndWatch(Empty) returns (stream ListAndWatchResponse) {}

        // GetPreferredAllocation returns a preferred set of devices to allocate
        // from a list of available ones. The resulting preferred allocation is not
        // guaranteed to be the allocation ultimately performed by the
        // devicemanager. It is only designed to help the devicemanager make a more
        // informed allocation decision when possible.
        rpc GetPreferredAllocation(PreferredAllocationRequest) returns (PreferredAllocationResponse) {}

        // Allocate is called during container creation so that the Device
        // Plugin can run device specific operations and instruct Kubelet
        // of the steps to make the Device available in the container
        rpc Allocate(AllocateRequest) returns (AllocateResponse) {}

        // PreStartContainer is called, if indicated by Device Plugin during registeration phase,
        // before each container start. Device 2020-11-11-GPU_shareplugin can run device specific operations
        // such as resetting the device before making devices available to the container
        rpc PreStartContainer(PreStartContainerRequest) returns (PreStartContainerResponse) {}
}

//protobuf生成的go语言接口，device plugin插件实现以下接口即可
// DevicePluginServer is the server API for DevicePlugin service.
type DevicePluginServer interface {
    // GetDevicePluginOptions returns options to be communicated with Device
    // Manager
    GetDevicePluginOptions(context.Context, *Empty) (*DevicePluginOptions, error)
    // ListAndWatch returns a stream of List of Devices
    // Whenever a Device state change or a Device disappears, ListAndWatch
    // returns the new list
    ListAndWatch(*Empty, DevicePlugin_ListAndWatchServer) error
    // GetPreferredAllocation returns a preferred set of devices to allocate
    // from a list of available ones. The resulting preferred allocation is not
    // guaranteed to be the allocation ultimately performed by the
    // devicemanager. It is only designed to help the devicemanager make a more
    // informed allocation decision when possible.
    GetPreferredAllocation(context.Context, *PreferredAllocationRequest) (*PreferredAllocationResponse, error)
    // Allocate is called during container creation so that the Device
    // Plugin can run device specific operations and instruct Kubelet
    // of the steps to make the Device available in the container
    Allocate(context.Context, *AllocateRequest) (*AllocateResponse, error)
    // PreStartContainer is called, if indicated by Device Plugin during registeration phase,
    // before each container start. Device plugin can run device specific operations
    // such as resetting the device before making devices available to the container
    PreStartContainer(context.Context, *PreStartContainerRequest) (*PreStartContainerResponse, error)
}
```

注：插件没有要求一定要实现GetPreferredAllocation()或PreStartContainer()接口。
应当在通过调用GetDevicePluginOptions()发送回的DevicePluginOptions消息中设置指示这些调用中哪些是(如果有)可用的标志。 
kubelet将始终调用GetDevicePluginOptions()来查看哪些可选功能，然后再直接调用其中的任何一个。

插件通过主机路径/var/lib/kubelet/device-plugins/kubelet.sock上的Unix套接字向kubelet注册,
成功注册自身后，设备插件将以服务模式运行，在此期间，它将持续监视设备运行状况，并在设备状态发生任何变化时向kubelet报告。
它还负责服务分配gRPC请求。在分配期间，设备插件可能会进行设备特定的准备；
例如，GPU清理或QRNG初始化。如果操作成功，设备插件将返回一个AllocateResponse，其中包含用于访问分配的设备的容器运行时配置。 
kubelet将此信息传递给容器运行时.

在device plugin的实现中，最关键的两个要实现的方法是`ListAndWatch`和`Allocate`

kubelet在什么时候会去调用device plugin的`ListAndWatch`和`Allocate`？
ListAndWatch, 当device plugin插件往kubelet注册的时候会调用到
```
Register -> m.addEndpoint -> m.runEndpoint -> e.run() -> e.client.ListAndWatch
```

Allocate，kubelet在创建pod的过程中启动container阶段调用到
```
NewMainKubelet -> klet.syncPod -> kl.containerRuntime.SyncPod

// SyncPod syncs the running pod into the desired pod by executing following steps:
//
//  1. Compute sandbox and container changes.
//  2. Kill pod sandbox if necessary.
//  3. Kill any containers that should not be running.
//  4. Create sandbox if necessary.
//  5. Create ephemeral containers.
//  6. Create init containers.
//  7. Create normal containers.

-> m.startContainer
// startContainer starts a container and returns a message indicates why it is failed on error.
// It starts the container through the following steps:
// * pull the image
// * create the container
// * start the container
// * run the post start lifecycle hooks (if applicable)

-> m.generateContainerConfig -> m.runtimeHelper.GenerateRunContainerOptions 
-> kl.containerManager.GetResources -> cm.deviceManager.GetDeviceRunContainerOptions
-> m.Allocate -> m.allocateContainerResources -> eI.e.allocate -> e.client.Allocate
```

kubelet服务重启如何处理？
>设备插件期望是检测到kubelet重新启动并向新的kubelet实例重新注册.
>在当前的实现中，一个新的kubelet实例在启动时会删除/var/lib/kubelet/device-plugins下的所有现有Unix套接字.
>设备插件可以监视其Unix套接字的删除，并在发生此类事件时重新注册自己.
>一般是使用 fsnotify类似的库监控kubelet.sock的重新创建事件.

[sample-device-plugin实现](https://github.com/yaoice/sample-device-plugin)

#### device plugin部署

>可以将设备插件作为DaemonSet部署，作为节点操作系统的软件包部署，也可以手动部署。
>规范目录`/var/lib/kubelet/device-plugins`需要特权访问，因此设备插件必须在特权安全上下文中运行。
>如果要将设备插件部署为DaemonSet，则必须将/var/lib/kubelet/device-plugins作为卷挂载在插件的PodSpec中。
>如果选择DaemonSet方法，则可以依靠Kubernetes来执行以下操作：将设备插件的Pod放置在节点上，
>在出现故障后重新启动daemon Pod，并帮助自动进行升级。

#### device plugin资源监控

FEATURE STATE: Kubernetes v1.15 [beta]

>为了监视device plugin提供的资源，监视代理程序必须能够发现节点上正在使用的一组设备，并获取元数据以描述metric应与哪个容器相关联。
>设备监视代理程序暴露的Prometheus指标应遵循[Kubernetes Instrumentation](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-instrumentation/instrumentation.md)指南，
>使用`pod`，`namespace`和`container`这些prometheus label来标识容器。

kubelet提供了gRPC服务以发现正在使用的设备，并为这些设备提供元数据：
```
// PodResourcesLister is a service provided by the kubelet that provides information about the
// node resources consumed by pods and containers on the node
service PodResourcesLister {
    rpc List(ListPodResourcesRequest) returns (ListPodResourcesResponse) {}
}
```
gRPC服务通过`/var/lib/kubelet/pod-resources/kubelet.sock`上的Unix套接字提供.
device plugin资源的监视代理程序可以部署为守护程序或DaemonSet.规范目录/var/lib/kubelet/pod-resources需要特权访问，
因此监视代理程序必须在特权安全上下文中运行.如果设备监视代理程序作为DaemonSet运行，
则必须将`/var/lib/kubelet/pod-resources`作为卷挂载在插件的[PodSpec](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.19/#podspec-v1-core)中。

#### device plugin集成topology

FEATURE STATE: Kubernetes v1.18 [beta]

>拓扑管理器是一个Kubelet组件，它允许以拓扑对齐方式协调资源。为了做到这一点，设备插​件API进行了扩展，以包含`TopologyInfo`结构体。
```
message TopologyInfo {
    repeated NUMANode nodes = 1;
}

message NUMANode {
    int64 ID = 1;
}
```
>希望利用topology管理器的设备插件可以将填充的TopologyInfo结构作为设备注册的一部分以及设备ID和设备的运行状况发送回去。
>然后，设备管理器将使用此信息来咨询拓扑管理器并做出资源分配决策。
>TopologyInfo支持的`nodes`字段为nil（默认值）或NUMA节点列表。这样就可以发布可以跨越NUMA个节点的设备插件。
 
由device plugin为设备填充的示例`TopologyInfo`结构体：
```
pluginapi.Device{ID: "25102017", Health: pluginapi.Healthy, Topology:&pluginapi.TopologyInfo{Nodes: []*pluginapi.NUMANode{&pluginapi.NUMANode{ID: 0,},}}}
```

### 参考链接

- [Kubernetes开发知识–device-plugin的实现](https://www.myway5.com/index.php/2020/03/24/kubernetes%E5%BC%80%E5%8F%91%E7%9F%A5%E8%AF%86-device-plugin%E7%9A%84%E5%AE%9E%E7%8E%B0/)
- [https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)