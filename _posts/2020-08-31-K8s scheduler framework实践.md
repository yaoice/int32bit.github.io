---
layout: post
title: K8s scheduler framework实践
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

k8s版本: v1.18.8

### 什么是Scheduler Framework

Scheduler Framework在Kubernetes v1.15版本中作为alpha功能引入，调度框架是Kubernetes Scheduler的可插拔架构，可简化调度程序的自定义。 
它将一组新的“插件” API添加到现有的调度程序中。 插件被编译到调度程序中。 这些API允许大多数调度功能实现为插件，同时使调度“核心”保持简单且可维护。 
有关该框架设计的更多技术信息，请参阅[调度框架的设计建议](https://github.com/kubernetes/enhancements/blob/master/keps/sig-scheduling/20180409-scheduling-framework.md)。


### Scheduler Framework工作流程

调度框架定义了一些扩展点。 Scheduler插件注册以在一个或多个扩展点处调用。 这些插件中的一些可以更改调度决策，而某些仅提供信息。

每次调度一个Pod的尝试都分为两个阶段，即调度周期和绑定周期。

#### 调度周期&绑定周期

调度周期为Pod选择一个节点，绑定周期将该决定应用于集群。 调度周期和绑定周期一起被称为“调度上下文”。

调度周期是串行运行的，而绑定周期可能是同时运行的。

如果确定Pod不可调度或存在内部错误，则可以中止调度或绑定周期。 Pod将返回队列并重试。

#### 扩展点

下图显示了Pod的调度上下文以及调度框架公开的扩展点。 在这张图中，Filter等价于预选(Predicate)，Scoring等价于优选(Priority function).
在这些扩展点中的一个或多个扩展点处注册了要调用的插件。 在以下部分中，我们将按照每个扩展点的调用顺序对其进行描述。

一个插件可以在多个扩展点注册以执行更复杂或有状态的任务。

<img src="/img/posts/2020-08-31/pod-scheduling-context.png"/>

1. QueueSort

    这些插件用于对调度队列中的Pod进行排序。queue sort插件实质上提供了Less（Pod1，Pod2）函数。一次只能启用一个queue sort插件

2. PreFilter

    这些插件用于预处理有关Pod的信息，或检查集群或Pod必须满足的某些条件。如果PreFilter插件返回错误，则调度周期中止

3. Filter

    这些插件用于过滤无法运行Pod的节点。对于每个节点，调度程序将按其配置顺序调用filter插件。
    如果有任何过滤器插件将该节点标记为不可行，则不会为该节点调用其余插件。节点可以被并发评估

4. PostFilter

    这些插件在Filter阶段之后被调用，但是仅在找不到可行节点时该节点才被调用。 
    插件按其配置顺序调用。 如果有任何postFilter插件将节点标记为Schedulable，则不会调用其余的插件。
    一个典型的PostFilter实现是抢占，它试图通过抢占其他Pod来使Pod可调度

5. PreScore

    这些插件用于执行"预评分"工作，从而为Score插件使用提供可共享的状态。如果PreScore插件返回错误，则调度周期将中止。

6. Score

    这些插件用于对已通过filter阶段的节点进行排名。调度程序将为每个节点调用每个scoring插件。 
    将有一个定义明确的整数范围，代表最低分和最高分。在NormalizeScore阶段之后，调度程序将根据配置的插件权重合并所有插件的节点分数

7. NormalizeScore

    这些插件用于在调度程序计算节点的最终排名之前修改分数。注册此扩展点的插件将与同一插件的得分结果一起调用。每个插件每个调度周期调用一次。
    如果任何NormalizeScore插件返回错误，则调度周期将中止。(希望执行"pre-reserve"工作的插件应使用NormalizeScore扩展点)

8. Reserve

    实现Reserve扩展的插件有两种方法，即Reserve和Unreserve，分别支持两个信息调度阶段，分别称为Reserve和Unreserve。
    当为给定Pod保留和不保留节点上的资源时，维护运行时状态的插件（也称为"有状态插件"）应使用这些阶段, 由调度程序通知。
    
    Reserve阶段发生在调度程序实际将Pod绑定到其指定节点之前。它的存在是为了防止调度程序在等待绑定成功时出现争用情况。
    每个Reserve插件的Reserve方法可能成功或失败；如果一个Reserve方法调用失败，则不执行后续插件，并且Reserve阶段被视为失败。
    如果所有插件的Reserve方法都成功，则认为Reserve阶段成功，并且将执行其余的调度周期和绑定周期。
    
    如果Reserve阶段或后续阶段失败，则会触发Unreserve阶段。发生这种情况时，将以与Reserve方法调用相反的顺序执行所有Reserve插件的Unreserve方法。
    存在该阶段以清除与保留的Pod相关联的状态。(Reserve插件中Unreserve方法的实现必须是幂等的，并且不会失败)

9. Permit

    在每个Pod的调度周期结束时，将调用Permit插件，以防止或延迟与候选节点的绑定。 permit插件可以执行以下三项操作之一：
    
    - approve 
    
        一旦所有permit插件批准Pod，便将其发送以进行绑定。
        
    - deny
        
        如果任何permit插件拒绝Pod，则将其返回到调度队列。 这将触发Reserve插件中的Unreserve阶段。
    
    - wait(with a timeout)
    
        如果Permit插件返回"wait"，则Pod会保留在内部的"waiting" Pods列表中，此Pod的绑定周期开始，但会直接阻塞，直到获得批准为止。 
        如果发生超时，wait将变为deny，并且Pod将返回到调度队列，从而触发Reserve插件中的Unreserve阶段。
    
    注意：尽管任何插件都可以访问"waiting"的Pod列表并进行批准（请参阅[FrameworkHandle](https://github.com/kubernetes/enhancements/blob/master/keps/sig-scheduling/20180409-scheduling-framework.md#frameworkhandle),但我们希望只有permit插件才能批准处于"waiting"状态的保留Pod的绑定。 
    批准Pod后，将其发送到PreBind阶段

10. PreBind

    这些插件用于执行绑定Pod之前所需的任何工作。 例如，PreBind插件可以设置网络卷并将其挂载在目标节点上，然后再允许Pod在此处运行。
    
    如果任何PreBind插件返回错误，则Pod被拒绝并返回到调度队列

11. Bind

    这些插件用于将Pod绑定到节点。 在所有PreBind插件完成之前，不会调用Bind插件。 
    每个Bind插件均按配置顺序调用。 Bind插件可以选择是否处理给定的Pod。 
    如果Bind插件选择处理Pod，则会跳过其余的Bind插件。

12. PostBind

    成功绑定Pod后，将调用PostBind插件。绑定周期到此结束，可以用来清理关联的资源。

### 插件开发

来看个例子[coscheduling](https://github.com/kubernetes-sigs/scheduler-plugins)

coscheduling的启动程序
```
import (
	"math/rand"
	"os"
	"time"

	"k8s.io/kubernetes/cmd/kube-scheduler/app"

	"sigs.k8s.io/scheduler-plugins/pkg/coscheduling"
	"sigs.k8s.io/scheduler-plugins/pkg/qos"
)

func main() {
	rand.Seed(time.Now().UnixNano())
	// Register custom plugins to the scheduler framework.
	// Later they can consist of scheduler profile(s) and hence
	// used by various kinds of workloads.
	command := app.NewSchedulerCommand(
		app.WithPlugin(coscheduling.Name, coscheduling.New),
		app.WithPlugin(qos.Name, qos.New),
	)
	if err := command.Execute(); err != nil {
		os.Exit(1)
	}
}
```
app.WithPlugin用于注册out-of-tree插件，每个插件都必须定义一个构造函数并将其添加到硬编码的registry中。 有关构造函数args的更多信息，请参见[可选参数](https://github.com/kubernetes/enhancements/blob/master/keps/sig-scheduling/20180409-scheduling-framework.md#optional-args)。

#### WithPlugin函数

```
// Option configures a framework.Registry.
// 输入参数是插件列表的map数据结构
type Option func(framework.Registry) error

// PluginFactory is a function that builds a plugin.
type PluginFactory = func(configuration *runtime.Unknown, f FrameworkHandle) (Plugin, error)

// WithPlugin creates an Option based on plugin name and factory. Please don't remove this function: it is used to register out-of-tree plugins,
// hence there are no references to it from the kubernetes scheduler code base.
// WithPlugin函数有两个参数，一个是插件名称，另一个是个工厂函数PluginFactory，返回一个有名函数Option
func WithPlugin(name string, factory framework.PluginFactory) Option {
	return func(registry framework.Registry) error {
		return registry.Register(name, factory)
	}
}
```

```
// Registry is a collection of all available plugins. The framework uses a
// registry to enable and initialize configured plugins.
// All plugins must be in the registry before initializing the framework.
// 插件列表的map数据结构
type Registry map[string]PluginFactory


// Register adds a new plugin to the registry. If a plugin with the same name
// exists, it returns an error.
// 注册插件
func (r Registry) Register(name string, factory PluginFactory) error {
	if _, ok := r[name]; ok {
		return fmt.Errorf("a plugin named %v already exists", name)
	}
	r[name] = factory
	return nil
}
```
实现插件API有两个步骤。 首先，插件必须注册并配置，然后才能使用扩展点接口。 扩展点接口具有以下形式。

#### Plugin接口

插件工厂函数返回的是一个Plugin接口类型
```
// PluginFactory is a function that builds a plugin.
type PluginFactory = func(configuration *runtime.Unknown, f FrameworkHandle) (Plugin, error)
```

Plugin接口定义
```
// Plugin is the parent type for all the scheduling framework plugins.
type Plugin interface {
	Name() string
}
```
还有很多包含Plugin接口的接口定义

#### QueueSortPlugin接口
```
// QueueSortPlugin is an interface that must be implemented by "QueueSort" plugins.
// These plugins are used to sort pods in the scheduling queue. Only one queue sort
// plugin may be enabled at a time.
type QueueSortPlugin interface {
	Plugin
	// Less are used to sort pods in the scheduling queue.
	Less(*PodInfo, *PodInfo) bool
}
```

#### PreFilterPlugin接口
```
// PreFilterPlugin is an interface that must be implemented by "prefilter" plugins.
// These plugins are called at the beginning of the scheduling cycle.
type PreFilterPlugin interface {
	Plugin
	// PreFilter is called at the beginning of the scheduling cycle. All PreFilter
	// plugins must return success or the pod will be rejected.
	PreFilter(ctx context.Context, state *CycleState, p *v1.Pod) *Status
	// PreFilterExtensions returns a PreFilterExtensions interface if the plugin implements one,
	// or nil if it does not. A Pre-filter plugin can provide extensions to incrementally
	// modify its pre-processed info. The framework guarantees that the extensions
	// AddPod/RemovePod will only be called after PreFilter, possibly on a cloned
	// CycleState, and may call those functions more than once before calling
	// Filter again on a specific node.
	PreFilterExtensions() PreFilterExtensions
}
```

#### FilterPlugin接口

```
// FilterPlugin is an interface for Filter plugins. These plugins are called at the
// filter extension point for filtering out hosts that cannot run a pod.
// This concept used to be called 'predicate' in the original scheduler.
// These plugins should return "Success", "Unschedulable" or "Error" in Status.code.
// However, the scheduler accepts other valid codes as well.
// Anything other than "Success" will lead to exclusion of the given host from
// running the pod.
type FilterPlugin interface {
	Plugin
	// Filter is called by the scheduling framework.
	// All FilterPlugins should return "Success" to declare that
	// the given node fits the pod. If Filter doesn't return "Success",
	// please refer scheduler/algorithm/predicates/error.go
	// to set error message.
	// For the node being evaluated, Filter plugins should look at the passed
	// nodeInfo reference for this particular node's information (e.g., pods
	// considered to be running on the node) instead of looking it up in the
	// NodeInfoSnapshot because we don't guarantee that they will be the same.
	// For example, during preemption, we may pass a copy of the original
	// nodeInfo object that has some pods removed from it to evaluate the
	// possibility of preempting them to schedule the target pod.
	Filter(ctx context.Context, state *CycleState, pod *v1.Pod, nodeInfo *schedulernodeinfo.NodeInfo) *Status
}
```

#### PreScorePlugin接口

```
// PreScorePlugin is an interface for Pre-score plugin. Pre-score is an
// informational extension point. Plugins will be called with a list of nodes
// that passed the filtering phase. A plugin may use this data to update internal
// state or to generate logs/metrics.
type PreScorePlugin interface {
	Plugin
	// PreScore is called by the scheduling framework after a list of nodes
	// passed the filtering phase. All prescore plugins must return success or
	// the pod will be rejected
	PreScore(ctx context.Context, state *CycleState, pod *v1.Pod, nodes []*v1.Node) *Status
}
```

#### ScorePlugin接口

```
// ScorePlugin is an interface that must be implemented by "score" plugins to rank
// nodes that passed the filtering phase.
type ScorePlugin interface {
	Plugin
	// Score is called on each filtered node. It must return success and an integer
	// indicating the rank of the node. All scoring plugins must return success or
	// the pod will be rejected.
	Score(ctx context.Context, state *CycleState, p *v1.Pod, nodeName string) (int64, *Status)

	// ScoreExtensions returns a ScoreExtensions interface if it implements one, or nil if does not.
	ScoreExtensions() ScoreExtensions
}
```

#### ReservePlugin接口

```
// ReservePlugin is an interface for Reserve plugins. These plugins are called
// at the reservation point. These are meant to update the state of the plugin.
// This concept used to be called 'assume' in the original scheduler.
// These plugins should return only Success or Error in Status.code. However,
// the scheduler accepts other valid codes as well. Anything other than Success
// will lead to rejection of the pod.
type ReservePlugin interface {
	Plugin
	// Reserve is called by the scheduling framework when the scheduler cache is
	// updated.
	Reserve(ctx context.Context, state *CycleState, p *v1.Pod, nodeName string) *Status
}
```

#### PreBindPlugin接口

```
// PreBindPlugin is an interface that must be implemented by "prebind" plugins.
// These plugins are called before a pod being scheduled.
type PreBindPlugin interface {
	Plugin
	// PreBind is called before binding a pod. All prebind plugins must return
	// success or the pod will be rejected and won't be sent for binding.
	PreBind(ctx context.Context, state *CycleState, p *v1.Pod, nodeName string) *Status
}
```

#### PostBindPlugin接口

```
// PostBindPlugin is an interface that must be implemented by "postbind" plugins.
// These plugins are called after a pod is successfully bound to a node.
type PostBindPlugin interface {
	Plugin
	// PostBind is called after a pod is successfully bound. These plugins are
	// informational. A common application of this extension point is for cleaning
	// up. If a plugin needs to clean-up its state after a pod is scheduled and
	// bound, PostBind is the extension point that it should register.
	PostBind(ctx context.Context, state *CycleState, p *v1.Pod, nodeName string)
}
```

#### UnreservePlugin接口

```
// UnreservePlugin is an interface for Unreserve plugins. This is an informational
// extension point. If a pod was reserved and then rejected in a later phase, then
// un-reserve plugins will be notified. Un-reserve plugins should clean up state
// associated with the reserved Pod.
type UnreservePlugin interface {
	Plugin
	// Unreserve is called by the scheduling framework when a reserved pod was
	// rejected in a later phase.
	Unreserve(ctx context.Context, state *CycleState, p *v1.Pod, nodeName string)
}
```

#### PermitPlugin接口

```
// PermitPlugin is an interface that must be implemented by "permit" plugins.
// These plugins are called before a pod is bound to a node.
type PermitPlugin interface {
	Plugin
	// Permit is called before binding a pod (and before prebind plugins). Permit
	// plugins are used to prevent or delay the binding of a Pod. A permit plugin
	// must return success or wait with timeout duration, or the pod will be rejected.
	// The pod will also be rejected if the wait timeout or the pod is rejected while
	// waiting. Note that if the plugin returns "wait", the framework will wait only
	// after running the remaining plugins given that no other plugin rejects the pod.
	Permit(ctx context.Context, state *CycleState, p *v1.Pod, nodeName string) (*Status, time.Duration)
}
```

#### BindPlugin接口

```
// BindPlugin is an interface that must be implemented by "bind" plugins. Bind
// plugins are used to bind a pod to a Node.
type BindPlugin interface {
	Plugin
	// Bind plugins will not be called until all pre-bind plugins have completed. Each
	// bind plugin is called in the configured order. A bind plugin may choose whether
	// or not to handle the given Pod. If a bind plugin chooses to handle a Pod, the
	// remaining bind plugins are skipped. When a bind plugin does not handle a pod,
	// it must return Skip in its Status code. If a bind plugin returns an Error, the
	// pod is rejected and will not be bound.
	Bind(ctx context.Context, state *CycleState, p *v1.Pod, nodeName string) *Status
}
```

#### CycleState

```
// CycleState provides a mechanism for plugins to store and retrieve arbitrary data.
// StateData stored by one plugin can be read, altered, or deleted by another plugin.
// CycleState does not provide any data protection, as all plugins are assumed to be
// trusted.
type CycleState struct {
	mx      sync.RWMutex
	storage map[StateKey]StateData
	// if recordPluginMetrics is true, PluginExecutionDuration will be recorded for this cycle.
	recordPluginMetrics bool
}
```
大多数插件函数将使用CycleState这个参数。 CycleState表示当前的调度上下文。

CycleState将提供API，用于访问范围为当前调度上下文的数据。因为绑定周期可以同时执行，所以插件可以使用CycleState来确保它们正在处理正确的请求。

CycleState还提供类似于context.WithValue的API，可用于在不同扩展点的插件之间传递数据。多个插件可以共享状态或通过此机制进行通信。
仅在单个调度上下文中保留状态。值得注意的是，假定插件是受信任的。调度程序不会阻止一个插件访问或修改另一个插件的状态。(唯一的例外是QueueSort插件)

注：在调度上下文结束后，通过CycleState可用的数据无效，并且插件保存对该数据的引用的时间不应超过必要的时间。

#### FrameworkHandle接口

```
// PluginFactory is a function that builds a plugin.
type PluginFactory = func(configuration *runtime.Unknown, f FrameworkHandle) (Plugin, error)
```
插件工厂函数，输入参数有两个，一个是配置参数，另一个是FrameworkHandle接口

FrameworkHandle接口
```
// FrameworkHandle provides data and some tools that plugins can use. It is
// passed to the plugin factories at the time of plugin initialization. Plugins
// must store and use this handle to call framework functions.
type FrameworkHandle interface {
	// SnapshotSharedLister returns listers from the latest NodeInfo Snapshot. The snapshot
	// is taken at the beginning of a scheduling cycle and remains unchanged until
	// a pod finishes "Permit" point. There is no guarantee that the information
	// remains unchanged in the binding phase of scheduling, so plugins in the binding
	// cycle (pre-bind/bind/post-bind/un-reserve plugin) should not use it,
	// otherwise a concurrent read/write error might occur, they should use scheduler
	// cache instead.
	SnapshotSharedLister() schedulerlisters.SharedLister

	// IterateOverWaitingPods acquires a read lock and iterates over the WaitingPods map.
	IterateOverWaitingPods(callback func(WaitingPod))

	// GetWaitingPod returns a waiting pod given its UID.
	GetWaitingPod(uid types.UID) WaitingPod

	// RejectWaitingPod rejects a waiting pod given its UID.
	RejectWaitingPod(uid types.UID)

	// ClientSet returns a kubernetes clientSet.
	ClientSet() clientset.Interface

	SharedInformerFactory() informers.SharedInformerFactory

	// VolumeBinder returns the volume binder used by scheduler.
	VolumeBinder() scheduling.SchedulerVolumeBinder
}
```
虽然CycleState提供与单个调度上下文有关的API，但是FrameworkHandle提供与插件的生命周期有关的API。 
这就是插件如何获取客户端（kubernetes.Interface）和SharedInformerFactory或从调度程序的群集状态缓存读取数据的方式。 
该句柄还将提供API以列出和批准或拒绝等待的Pod。

注：FrameworkHandle提供对kubernetes API服务器和调度程序内部缓存的访问。不能保证两者都是同步的，编写使用两者数据的插件时应格外小心。

要实现有用的功能，必须为插件提供对API服务器的访问权限，特别是当这些功能使用了调度程序通常不考虑的对象类型时。
提供SharedInformerFactory可使插件安全共享缓存。

注册完plugin后，kube-scheduler会对这些插件进行实例化
```
k8s.io/kubernetes/pkg/scheduler/framework/runtime/framework.go

// NewFramework initializes plugins given the configuration and the registry.
func NewFramework(r Registry, plugins *config.Plugins, args []config.PluginConfig, opts ...Option) (framework.Framework, error) {
	options := defaultFrameworkOptions
	for _, opt := range opts {
		opt(&options)
	}

	f := &frameworkImpl{
		registry:              r,
		snapshotSharedLister:  options.snapshotSharedLister,
		pluginNameToWeightMap: make(map[string]int),
		waitingPods:           newWaitingPodsMap(),
		clientSet:             options.clientSet,
		eventRecorder:         options.eventRecorder,
		informerFactory:       options.informerFactory,
		metricsRecorder:       options.metricsRecorder,
		profileName:           options.profileName,
		runAllFilters:         options.runAllFilters,
	}
	f.preemptHandle = &preemptHandle{
		extenders:     options.extenders,
		PodNominator:  options.podNominator,
		PluginsRunner: f,
	}
	if plugins == nil {
		return f, nil
	}

	// get needed plugins from config
	pg := f.pluginsNeeded(plugins)

	pluginConfig := make(map[string]runtime.Object, len(args))
	for i := range args {
		name := args[i].Name
		if _, ok := pluginConfig[name]; ok {
			return nil, fmt.Errorf("repeated config for plugin %s", name)
		}
		pluginConfig[name] = args[i].Args
	}

	pluginsMap := make(map[string]framework.Plugin)
	var totalPriority int64
	for name, factory := range r {
		// initialize only needed plugins.
		if _, ok := pg[name]; !ok {
			continue
		}

		args, err := getPluginArgsOrDefault(pluginConfig, name)
		if err != nil {
			return nil, fmt.Errorf("getting args for Plugin %q: %w", name, err)
		}
		p, err := factory(args, f)
		if err != nil {
			return nil, fmt.Errorf("error initializing plugin %q: %v", name, err)
		}
		pluginsMap[name] = p

		// a weight of zero is not permitted, plugins can be disabled explicitly
		// when configured.
		f.pluginNameToWeightMap[name] = int(pg[name].Weight)
		if f.pluginNameToWeightMap[name] == 0 {
			f.pluginNameToWeightMap[name] = 1
		}
		// Checks totalPriority against MaxTotalScore to avoid overflow
		if int64(f.pluginNameToWeightMap[name])*framework.MaxNodeScore > framework.MaxTotalScore-totalPriority {
			return nil, fmt.Errorf("total score of Score plugins could overflow")
		}
		totalPriority += int64(f.pluginNameToWeightMap[name]) * framework.MaxNodeScore
	}

	for _, e := range f.getExtensionPoints(plugins) {
		if err := updatePluginList(e.slicePtr, e.plugins, pluginsMap); err != nil {
			return nil, err
		}
	}

	// Verifying the score weights again since Plugin.Name() could return a different
	// value from the one used in the configuration.
	for _, scorePlugin := range f.scorePlugins {
		if f.pluginNameToWeightMap[scorePlugin.Name()] == 0 {
			return nil, fmt.Errorf("score plugin %q is not configured with weight", scorePlugin.Name())
		}
	}

	if len(f.queueSortPlugins) == 0 {
		return nil, fmt.Errorf("no queue sort plugin is enabled")
	}
	if len(f.queueSortPlugins) > 1 {
		return nil, fmt.Errorf("only one queue sort plugin can be enabled")
	}
	if len(f.bindPlugins) == 0 {
		return nil, fmt.Errorf("at least one bind plugin is needed")
	}

	return f, nil
}
```

```
// frameworkImpl is the component responsible for initializing and running scheduler
// plugins.
type frameworkImpl struct {
	registry              Registry
	snapshotSharedLister  framework.SharedLister
	waitingPods           *waitingPodsMap
	pluginNameToWeightMap map[string]int
	queueSortPlugins      []framework.QueueSortPlugin
	preFilterPlugins      []framework.PreFilterPlugin
	filterPlugins         []framework.FilterPlugin
	postFilterPlugins     []framework.PostFilterPlugin
	preScorePlugins       []framework.PreScorePlugin
	scorePlugins          []framework.ScorePlugin
	reservePlugins        []framework.ReservePlugin
	preBindPlugins        []framework.PreBindPlugin
	bindPlugins           []framework.BindPlugin
	postBindPlugins       []framework.PostBindPlugin
	permitPlugins         []framework.PermitPlugin

	clientSet       clientset.Interface
	eventRecorder   events.EventRecorder
	informerFactory informers.SharedInformerFactory

	metricsRecorder *metricsRecorder
	profileName     string

	preemptHandle framework.PreemptHandle

	// Indicates that RunFilterPlugins should accumulate all failed statuses and not return
	// after the first failure.
	runAllFilters bool
}

// extensionPoint encapsulates desired and applied set of plugins at a specific extension
// point. This is used to simplify iterating over all extension points supported by the
// frameworkImpl.
type extensionPoint struct {
	// the set of plugins to be configured at this extension point.
	plugins *config.PluginSet
	// a pointer to the slice storing plugins implementations that will run at this
	// extension point.
	slicePtr interface{}
}

func (f *frameworkImpl) getExtensionPoints(plugins *config.Plugins) []extensionPoint {
	return []extensionPoint{
		{plugins.PreFilter, &f.preFilterPlugins},
		{plugins.Filter, &f.filterPlugins},
		{plugins.PostFilter, &f.postFilterPlugins},
		{plugins.Reserve, &f.reservePlugins},
		{plugins.PreScore, &f.preScorePlugins},
		{plugins.Score, &f.scorePlugins},
		{plugins.PreBind, &f.preBindPlugins},
		{plugins.Bind, &f.bindPlugins},
		{plugins.PostBind, &f.postBindPlugins},
		{plugins.Permit, &f.permitPlugins},
		{plugins.QueueSort, &f.queueSortPlugins},
	}
}
```
根据Plugins配置初始化需要的插件，并根据插件类型添加到相应的扩展点plugins列表中

#### 插件生命周期

插件初始化有两个步骤。
    
- 注册插件。
- 调度程序使用其配置来确定要实例化的插件。如果插件注册了多个扩展点，则仅实例化一次。
    
实例化插件时，将向其传递config args和FrameworkHandle。
    
插件编写者应考虑两种并发类型。在评估多个节点时，一个插件可能会被同时调用多次，而一个插件可能会从不同的调度上下文中被并发调用。
   
注：在一个调度上下文中，将对每个扩展点进行串行评估。
   
在调度程序的主线程中，一次仅处理一个调度周期。在下一个调度周期开始之前，直至并包括保留的任何扩展点都将完成。在保留阶段之后，绑定周期将异步执行。
这意味着可以从两个不同的调度上下文中并发调用一个插件，前提是至少有一个调用要在reserve后到达扩展点。有状态的插件应谨慎处理这些情况。
   
最后，根据拒绝Pod的方式，可以从Permit线程或Bind线程调用unreserve的插件。
   
注：QueueSort扩展点是一种特殊情况。它不是调度上下文的一部分，但可以对许多pod对同时调用。 
    
<img src="/img/posts/2020-08-31/parallel_threads_of_scheduling.png"/>

### 配置插件

调度程序的组件配置将enabled/disabled或以其他方式配置插件。 插件配置分为两部分。

1. 每个扩展点已启用插件的列表（及其运行顺序）。 如果省略了这些列表之一，则将使用默认列表。
2. 每个插件的一组可选的自定义插件参数。 省略插件的配置参数等效于使用该插件的默认配置。

插件配置由扩展点组织。 每个列表中都必须包含一个注册有多个要点的插件。

```
# k8s.io/kubernetes@v1.18.8/pkg/scheduler/apis/config/types.go
type KubeSchedulerConfiguration struct {
    // ...

	// Profiles are scheduling profiles that kube-scheduler supports. Pods can
	// choose to be scheduled under a particular profile by setting its associated
	// scheduler name. Pods that don't specify any scheduler name are scheduled
	// with the "default-scheduler" profile, if present here.
	Profiles []KubeSchedulerProfile

	// Extenders are the list of scheduler extenders, each holding the values of how to communicate
	// with the extender. These extenders are shared by all scheduler profiles.
	Extenders []Extender
}

// KubeSchedulerProfile is a scheduling profile.
type KubeSchedulerProfile struct {
	// SchedulerName is the name of the scheduler associated to this profile.
	// If SchedulerName matches with the pod's "spec.schedulerName", then the pod
	// is scheduled with this profile.
	SchedulerName string

	// Plugins specify the set of plugins that should be enabled or disabled.
	// Enabled plugins are the ones that should be enabled in addition to the
	// default plugins. Disabled plugins are any of the default plugins that
	// should be disabled.
	// When no enabled or disabled plugin is specified for an extension point,
	// default plugins for that extension point will be used if there is any.
	// If a QueueSort plugin is specified, the same QueueSort Plugin and
	// PluginConfig must be specified for all profiles.
	Plugins *Plugins

	// PluginConfig is an optional set of custom plugin arguments for each plugin.
	// Omitting config args for a plugin is equivalent to using the default config
	// for that plugin.
	PluginConfig []PluginConfig
}

// Plugins include multiple extension points. When specified, the list of plugins for
// a particular extension point are the only ones enabled. If an extension point is
// omitted from the config, then the default set of plugins is used for that extension point.
// Enabled plugins are called in the order specified here, after default plugins. If they need to
// be invoked before default plugins, default plugins must be disabled and re-enabled here in desired order.
type Plugins struct {
	// QueueSort is a list of plugins that should be invoked when sorting pods in the scheduling queue.
	QueueSort *PluginSet

	// PreFilter is a list of plugins that should be invoked at "PreFilter" extension point of the scheduling framework.
	PreFilter *PluginSet

	// Filter is a list of plugins that should be invoked when filtering out nodes that cannot run the Pod.
	Filter *PluginSet

	// PreScore is a list of plugins that are invoked before scoring.
	PreScore *PluginSet

	// Score is a list of plugins that should be invoked when ranking nodes that have passed the filtering phase.
	Score *PluginSet

	// Reserve is a list of plugins invoked when reserving a node to run the pod.
	Reserve *PluginSet

	// Permit is a list of plugins that control binding of a Pod. These plugins can prevent or delay binding of a Pod.
	Permit *PluginSet

	// PreBind is a list of plugins that should be invoked before a pod is bound.
	PreBind *PluginSet

	// Bind is a list of plugins that should be invoked at "Bind" extension point of the scheduling framework.
	// The scheduler call these plugins in order. Scheduler skips the rest of these plugins as soon as one returns success.
	Bind *PluginSet

	// PostBind is a list of plugins that should be invoked after a pod is successfully bound.
	PostBind *PluginSet

	// Unreserve is a list of plugins invoked when a pod that was previously reserved is rejected in a later phase.
	Unreserve *PluginSet
}

// PluginSet specifies enabled and disabled plugins for an extension point.
// If an array is empty, missing, or nil, default plugins at that extension point will be used.
type PluginSet struct {
	// Enabled specifies plugins that should be enabled in addition to default plugins.
	// These are called after default plugins and in the same order specified here.
	Enabled []Plugin
	// Disabled specifies default plugins that should be disabled.
	// When all default plugins need to be disabled, an array containing only one "*" should be provided.
	Disabled []Plugin
}

// Plugin specifies a plugin name and its weight when applicable. Weight is used only for Score plugins.
type Plugin struct {
	// Name defines the name of plugin
	Name string
	// Weight defines the weight of plugin, only used for Score plugins.
	Weight int32
}

// PluginConfig specifies arguments that should be passed to a plugin at the time of initialization.
// A plugin that is invoked at multiple extension points is initialized once. Args can have arbitrary structure.
// It is up to the plugin to process these Args.
type PluginConfig struct {
	// Name defines the name of plugin being configured
	Name string
	// Args defines the arguments passed to the plugins at the time of initialization. Args can have arbitrary structure.
	Args runtime.Unknown
}
```

配置文件样例
```
{
  "plugins": {
    "preFilter": [
      {
        "name": "PluginA"
      },
      {
        "name": "PluginB"
      },
      {
        "name": "PluginC"
      }
    ],
    "score": [
      {
        "name": "PluginA",
        "weight": 30
      },
      {
        "name": "PluginX",
        "weight": 50
      },
      {
        "name": "PluginY",
        "weight": 10
      }
    ]
  },
  "pluginConfig": [
    {
      "name": "PluginX",
      "args": {
        "favorite_color": "#326CE5",
        "favorite_number": 7,
        "thanks_to": "thockin"
      }
    }
  ]
}
```
指定enabled/disabled后，将仅启用特定扩展点的插件列表。 如果配置中省略了扩展点，则默认插件集将用于该扩展点。

变更评估单相关时，插件评估顺序由插件在配置中出现的顺序指定。 注册多个扩展点的插件在每个扩展点的顺序可以不同。

可选Args，插件可以使用任意结构从其配置接收参数。 由于一个插件可能出现在多个扩展点中，因此该配置位于PluginConfig的单独列表中。

举例：
```
{
   "name": "ServiceAffinity",
   "args": {
      "LabelName": "app",
      "LabelValue": "mysql"
   }
}

func NewServiceAffinity(args *runtime.Unknown, h FrameworkHandle) (Plugin, error) {
    if args == nil {
        return nil, errors.Errorf("cannot find service affinity plugin config")
    }
    if args.ContentType != "application/json" {
        return nil, errors.Errorf("cannot parse content type: %v", args.ContentType)
    }
    var config struct {
        LabelName, LabelValue string
    }
    if err := json.Unmarshal(args.Raw, &config); err != nil {
        return nil, errors.Wrap(err, "could not parse args")
    }
    //...
}
```

### 参考链接

- [https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/](https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/)
- [Kubernetes Scheduler Framework 扩展: 1. Coscheduling](https://developer.aliyun.com/article/756016)