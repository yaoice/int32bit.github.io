---
layout: post
title: K8s cloud-controller-manager阅读笔记
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

K8s版本：v1.18.3

### 简介

FEATURE STATE: Kubernetes v1.11 [beta]

>由于云驱动的开发和发布的步调与 Kubernetes 项目不同，将服务提供商专用代码抽象到 `cloud-controller-manager` 
>二进制中有助于云服务厂商在 Kubernetes 核心代码之外独立进行开发。cloud-controller-manager可以被链接到任何满足cloudprovider.Interface约束的云服务提供商。
>为了兼容旧版本，Kubernetes核心项目中提供的cloud-controller-manager使用和kube-controller-manager相同的云服务类库。
>已经在 Kubernetes 核心项目中支持的云服务提供商预计将通过使用 in-tree 的 cloud-controller-manager过渡为非 Kubernetes核心代码。

### 运行cloud-controller-manager

需要对集群配置做适当的修改以成功地运行云管理控制器：

- 一定不要为 kube-apiserver 和 kube-controller-manager 指定 --cloud-provider 标志。 
这将保证它们不会运行任何云服务专用循环逻辑，这将会由云管理控制器运行。未来这个标记将被废弃并去除。
- kubelet 必须使用 --cloud-provider=external 运行。 这是为了保证让 kubelet 知道在执行任何任务前，
它必须被云管理控制器初始化。

设置群集使用云管理控制器将用多种方式更改群集行为：
- 指定了`--cloud-provider=external`的kubelet将被添加一个 node.cloudprovider.kubernetes.io/uninitialized的污点，导致其在初始化过程中不可调度（NoSchedule）。
这将标记该节点在能够正常调度前，需要外部的控制器进行二次初始化。 
请注意，如果云管理控制器不可用，集群中的新节点会一直处于不可调度的状态。 
这个污点很重要，因为调度器可能需要关于节点的云服务特定的信息，比如他们的区域或类型（高端 CPU、GPU 支持、内存较大、临时实例等）。
- 集群中节点的云服务信息将不再能够从本地元数据中获取，取而代之的是所有获取节点信息的API调用都将通过云管理控制器。
这意味着你可以通过限制到 kubelet 云服务 API 的访问来提升安全性。
在更大的集群中你可能需要考虑云管理控制器是否会遇到速率限制，因为它现在负责集群中几乎所有到云服务的API调用。

云管理控制器可以实现：

- 节点控制器 - 负责使用云服务API更新kubernetes节点并删除在云服务上已经删除的kubernetes节点。
- 服务控制器 - 负责在云服务上为类型为LoadBalancer的service提供负载均衡器。
- 路由控制器 - 负责在云服务上配置网络路由。
- 如果你使用的是 out-of-tree 提供商，请按需实现其余任意特性。

### 开发cloud-controller-manager

>组件 cloud-controller-manager 是 云控制器管理器是 1.8 的 alpha 特性。
>在未来发布的版本中，这是将 Kubernetes 与任何其他云集成的最佳方式。
>Kubernetes v1.6 包含一个新的可执行文件叫做 cloud-controller-manager。
>cloud-controller-manager 是一个守护进程，其中嵌入了特定于某云环境的控制环。 
>这些特定于云环境的控制环最初位于 kube-controller-manager 中。 
>由于云供应商的开发和发布节奏与 Kubernetes 项目不同步，将特定于供应商的代码抽象到cloud-controller-manager可执行文件可以允许云供应商独立于核心 Kubernetes 代码进行演进。
 
#### 背景

>由于云驱动的开发和发布与 Kubernetes 项目本身步调不同，将特定于云环境的代码抽象到cloud-controller-manager二进制组件有助于云厂商独立于Kubernetes核心代码推进其驱动开发。

>Kubernetes项目提供cloud-controller-manager的框架代码，其中包含Go语言的接口，便于你（或者你的云驱动提供者）接驳你自己的实现。
>这意味着每个云驱动可以通过从 Kubernetes 核心代码导入软件包来实现一个cloud-controller-manager；
>每个云驱动会通过调用`cloudprovider.RegisterCloudProvider`接口来注册其自身实现代码，从而更新 记录可用云驱动的全局变量。

#### Out of Tree

要为你的云环境构建一个 out-of-tree 云控制器管理器：

1. 使用满足`cloudprovider.Interface`的实现创建一个Go语言包。
2. 使用来自Kubernetes核心代码库的`cloud-controller-manager中的main.go`作为main.go的模板。如上所述，唯一的区别应该是将导入的云包。
3. 在main.go中导入你的云包，确保你的包有一个init块来运行cloudprovider.RegisterCloudProvider。

很多云驱动都将其控制器管理器代码以开源代码的形式公开。如果你在开发一个新的cloud-controller-manager，你可以选择某个out-of-tree云控制器管理器作为出发点。

#### In Tree

>对于in-tree驱动，你可以将 in-tree 云控制器管理器作为群集中的 Daemonset 来运行。 有关详细信息，请参阅[云控制器管理器管理](https://kubernetes.io/zh/docs/tasks/administer-cluster/running-cloud-controller/)。

### 代码分析

以[rancher-cloud-provider](https://github.com/rancher/rancher-cloud-controller-manager)为例

#### 注册cloud provider

在启动程序main函数中加载rancher-cloud-controller-manager/rancher，从而触发init函数
```
# github.com/rancher/rancher-cloud-controller-manager/main.go

_ "github.com/rancher/rancher-cloud-controller-manager/rancher"
```

init函数里实现注册cloud provider
```
# github.com/rancher/rancher-cloud-controller-manager/rancher/rancher.go

func init() {
	cloudprovider.RegisterCloudProvider(providerName, func(config io.Reader) (cloudprovider.Interface, error) {
		return newRancherCloud(config)
	})
}
```

providers map结构记录cloud provider名字与provider具体实现对象的映射关系
```
// All registered cloud providers.
var (
	providersMutex sync.Mutex
	providers      = make(map[string]Factory)
)

// RegisterCloudProvider registers a cloudprovider.Factory by name.  This
// is expected to happen during app startup.
func RegisterCloudProvider(name string, cloud Factory) {
	providersMutex.Lock()
	defer providersMutex.Unlock()
	if _, found := providers[name]; found {
		glog.Fatalf("Cloud provider %q was registered twice", name)
	}
	glog.V(1).Infof("Registered cloud provider %q", name)
	providers[name] = cloud
}
```

获取对应cloud provider具体实现的对象
```
func main() {
	s := options.NewCloudControllerManagerServer()
	s.AddFlags(pflag.CommandLine)

	flag.InitFlags()
	logs.InitLogs()
	defer logs.FlushLogs()

	verflag.PrintAndExitIfRequested()

	cloud, err := cloudprovider.InitCloudProvider("rancher", s.CloudConfigFile)
	if err != nil {
		glog.Fatalf("Cloud provider could not be initialized: %v", err)
	}

	if err := app.Run(s, cloud); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
}
```
最终在`app.Run -> StartControllers`中会调用下面接口定义的函数

#### 实现cloud provider

要扩展一个新的cloud provider，就要实现cloudprovider.Interface里定义的函数，cloudprovider.Interface定义如下：
```
# k8s.io/kubernetes/pkg/cloudprovider/cloud.go

// Interface is an abstract, pluggable interface for cloud providers.
type Interface interface {
	// Initialize provides the cloud with a kubernetes client builder and may spawn goroutines
	// to perform housekeeping activities within the cloud provider.
	Initialize(clientBuilder controller.ControllerClientBuilder)
	// LoadBalancer returns a balancer interface. Also returns true if the interface is supported, false otherwise.
	LoadBalancer() (LoadBalancer, bool)
	// Instances returns an instances interface. Also returns true if the interface is supported, false otherwise.
	Instances() (Instances, bool)
	// Zones returns a zones interface. Also returns true if the interface is supported, false otherwise.
	Zones() (Zones, bool)
	// Clusters returns a clusters interface.  Also returns true if the interface is supported, false otherwise.
	Clusters() (Clusters, bool)
	// Routes returns a routes interface along with whether the interface is supported.
	Routes() (Routes, bool)
	// ProviderName returns the cloud provider ID.
	ProviderName() string
	// ScrubDNS provides an opportunity for cloud-provider-specific code to process DNS settings for pods.
	ScrubDNS(nameservers, searches []string) (nsOut, srchOut []string)
}
```

LoadBalancer()函数返回一个实现LoadBalancer接口的对象，LoadBalancer接口定义：
```
// LoadBalancer is an abstract, pluggable interface for load balancers.
type LoadBalancer interface {
	// TODO: Break this up into different interfaces (LB, etc) when we have more than one type of service
	// GetLoadBalancer returns whether the specified load balancer exists, and
	// if so, what its status is.
	// Implementations must treat the *v1.Service parameter as read-only and not modify it.
	// Parameter 'clusterName' is the name of the cluster as presented to kube-controller-manager
	GetLoadBalancer(clusterName string, service *v1.Service) (status *v1.LoadBalancerStatus, exists bool, err error)
	// EnsureLoadBalancer creates a new load balancer 'name', or updates the existing one. Returns the status of the balancer
	// Implementations must treat the *v1.Service and *v1.Node
	// parameters as read-only and not modify them.
	// Parameter 'clusterName' is the name of the cluster as presented to kube-controller-manager
	EnsureLoadBalancer(clusterName string, service *v1.Service, nodes []*v1.Node) (*v1.LoadBalancerStatus, error)
	// UpdateLoadBalancer updates hosts under the specified load balancer.
	// Implementations must treat the *v1.Service and *v1.Node
	// parameters as read-only and not modify them.
	// Parameter 'clusterName' is the name of the cluster as presented to kube-controller-manager
	UpdateLoadBalancer(clusterName string, service *v1.Service, nodes []*v1.Node) error
	// EnsureLoadBalancerDeleted deletes the specified load balancer if it
	// exists, returning nil if the load balancer specified either didn't exist or
	// was successfully deleted.
	// This construction is useful because many cloud providers' load balancers
	// have multiple underlying components, meaning a Get could say that the LB
	// doesn't exist even if some part of it is still laying around.
	// Implementations must treat the *v1.Service parameter as read-only and not modify it.
	// Parameter 'clusterName' is the name of the cluster as presented to kube-controller-manager
	EnsureLoadBalancerDeleted(clusterName string, service *v1.Service) error
}
```

Instances()函数返回一个实现Instances接口的对象，Instances接口定义：
```
// Instances is an abstract, pluggable interface for sets of instances.
type Instances interface {
	// NodeAddresses returns the addresses of the specified instance.
	// TODO(roberthbailey): This currently is only used in such a way that it
	// returns the address of the calling instance. We should do a rename to
	// make this clearer.
	NodeAddresses(name types.NodeName) ([]v1.NodeAddress, error)
	// NodeAddressesByProviderID returns the addresses of the specified instance.
	// The instance is specified using the providerID of the node. The
	// ProviderID is a unique identifier of the node. This will not be called
	// from the node whose nodeaddresses are being queried. i.e. local metadata
	// services cannot be used in this method to obtain nodeaddresses
	NodeAddressesByProviderID(providerId string) ([]v1.NodeAddress, error)
	// ExternalID returns the cloud provider ID of the node with the specified NodeName.
	// Note that if the instance does not exist or is no longer running, we must return ("", cloudprovider.InstanceNotFound)
	ExternalID(nodeName types.NodeName) (string, error)
	// InstanceID returns the cloud provider ID of the node with the specified NodeName.
	InstanceID(nodeName types.NodeName) (string, error)
	// InstanceType returns the type of the specified instance.
	InstanceType(name types.NodeName) (string, error)
	// InstanceTypeByProviderID returns the type of the specified instance.
	InstanceTypeByProviderID(providerID string) (string, error)
	// AddSSHKeyToAllInstances adds an SSH public key as a legal identity for all instances
	// expected format for the key is standard ssh-keygen format: <protocol> <blob>
	AddSSHKeyToAllInstances(user string, keyData []byte) error
	// CurrentNodeName returns the name of the node we are currently running on
	// On most clouds (e.g. GCE) this is the hostname, so we provide the hostname
	CurrentNodeName(hostname string) (types.NodeName, error)
}
```

Zones()函数返回一个实现Zones接口的对象，Zones接口定义：
```
// Zones is an abstract, pluggable interface for zone enumeration.
type Zones interface {
	// GetZone returns the Zone containing the current failure zone and locality region that the program is running in
	GetZone() (Zone, error)
}
```

Clusters()函数返回一个实现Clusters接口的对象，Clusters接口定义：
```
// Clusters is an abstract, pluggable interface for clusters of containers.
type Clusters interface {
	// ListClusters lists the names of the available clusters.
	ListClusters() ([]string, error)
	// Master gets back the address (either DNS name or IP address) of the master node for the cluster.
	Master(clusterName string) (string, error)
}
```

Routes()函数返回一个实现Routes接口的对象，Routes接口定义：
```
// Routes is an abstract, pluggable interface for advanced routing rules.
type Routes interface {
	// ListRoutes lists all managed routes that belong to the specified clusterName
	ListRoutes(clusterName string) ([]*Route, error)
	// CreateRoute creates the described managed route
	// route.Name will be ignored, although the cloud-provider may use nameHint
	// to create a more user-meaningful name.
	CreateRoute(clusterName string, nameHint string, route *Route) error
	// DeleteRoute deletes the specified managed route
	// Route should be as returned by ListRoutes
	DeleteRoute(clusterName string, route *Route) error
}
```

### 参考链接

- [https://kubernetes.io/zh/docs/tasks/administer-cluster/running-cloud-controller/](https://kubernetes.io/zh/docs/tasks/administer-cluster/running-cloud-controller/)
- [https://kubernetes.io/zh/docs/tasks/administer-cluster/developing-cloud-controller-manager/](https://kubernetes.io/zh/docs/tasks/administer-cluster/developing-cloud-controller-manager/)

