---
layout: post
title: kube-scheduler源码阅读笔记
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

- Kubernetes v1.14.6
- Etcd 3.3.12
- Docker 18.09.9

### kube-scheduler调度流程

kube-scheduler是k8s中的调度模块，是核心组件之一.

官方描述scheduler的流程：[kube-scheduler](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-scheduling/scheduler.md)

```
For given pod:

    +---------------------------------------------+
    |               Schedulable nodes:            |
    |                                             |
    | +--------+    +--------+      +--------+    |
    | | node 1 |    | node 2 |      | node 3 |    |
    | +--------+    +--------+      +--------+    |
    |                                             |
    +-------------------+-------------------------+
                        |
                        |
                        v
    +-------------------+-------------------------+

    Pred. filters: node 3 doesn't have enough resource

    +-------------------+-------------------------+
                        |
                        |
                        v
    +-------------------+-------------------------+
    |             remaining nodes:                |
    |   +--------+                 +--------+     |
    |   | node 1 |                 | node 2 |     |
    |   +--------+                 +--------+     |
    |                                             |
    +-------------------+-------------------------+
                        |
                        |
                        v
    +-------------------+-------------------------+

    Priority function:    node 1: p=2
                          node 2: p=5

    +-------------------+-------------------------+
                        |
                        |
                        v
            select max{node priority} = node 2
```

从上图可以看出，整个调度过程包含预选和打分两个过程, 先通过预选过滤一批节点, 再对
这些节点进行打分, 最后选出得分最高的那个节点.

### 代码入口

```
k8s.io/kubernetes/cmd/kube-scheduler/scheduler.go
```
解析命令行参数、设置参数默认值、设置默认调度策略

参数默认值设置在
```
k8s.io/kubernetes/pkg/scheduler/apis/config/v1alpha1/defaults.go
func SetDefaults_KubeSchedulerConfiguration()
```

应用跟调度相关的FeatureGates
```
algorithmprovider.ApplyFeatureGates()
```

这里定义了默认预选函数和默认打分函数
```
k8s.io/kubernetes/pkg/scheduler/algorithmprovider/defaults

func defaultPredicates() sets.String {
	return sets.NewString(
		predicates.NoVolumeZoneConflictPred,
		predicates.MaxEBSVolumeCountPred,
		predicates.MaxGCEPDVolumeCountPred,
		predicates.MaxAzureDiskVolumeCountPred,
		predicates.MaxCSIVolumeCountPred,
		predicates.MatchInterPodAffinityPred,
		predicates.NoDiskConflictPred,
		predicates.GeneralPred,
		predicates.CheckNodeMemoryPressurePred,
		predicates.CheckNodeDiskPressurePred,
		predicates.CheckNodePIDPressurePred,
		predicates.CheckNodeConditionPred,
		predicates.PodToleratesNodeTaintsPred,
		predicates.CheckVolumeBindingPred,
	)
}

func defaultPriorities() sets.String {
	return sets.NewString(
		priorities.SelectorSpreadPriority,
		priorities.InterPodAffinityPriority,
		priorities.LeastRequestedPriority,
		priorities.BalancedResourceAllocation,
		priorities.NodePreferAvoidPodsPriority,
		priorities.NodeAffinityPriority,
		priorities.TaintTolerationPriority,
		priorities.ImageLocalityPriority,
	)
}
```

预选函数也有执行顺序前后之分的, 执行顺序定义
```
k8s.io/kubernetes/pkg/scheduler/algorithm/predicates/predicates.go

// IMPORTANT NOTE: this list contains the ordering of the predicates, if you develop a new predicate
// it is mandatory to add its name to this list.
// Otherwise it won't be processed, see generic_scheduler#podFitsOnNode().
// The order is based on the restrictiveness & complexity of predicates.
// Design doc: https://github.com/kubernetes/community/blob/master/contributors/design-proposals/scheduling/predicates-ordering.md
var (
	predicatesOrdering = []string{CheckNodeConditionPred, CheckNodeUnschedulablePred,
		GeneralPred, HostNamePred, PodFitsHostPortsPred,
		MatchNodeSelectorPred, PodFitsResourcesPred, NoDiskConflictPred,
		PodToleratesNodeTaintsPred, PodToleratesNodeNoExecuteTaintsPred, CheckNodeLabelPresencePred,
		CheckServiceAffinityPred, MaxEBSVolumeCountPred, MaxGCEPDVolumeCountPred, MaxCSIVolumeCountPred,
		MaxAzureDiskVolumeCountPred, MaxCinderVolumeCountPred, CheckVolumeBindingPred, NoVolumeZoneConflictPred,
		CheckNodeMemoryPressurePred, CheckNodePIDPressurePred, CheckNodeDiskPressurePred, MatchInterPodAffinityPred}
)
```

启动过程最终调用Run函数，Run函数过程：
1. 初始化scheduler实例
2. 准备事件广播
3. 建立健康检查
4. 启动健康检查api
5. 启动所有informer
6. 是否开启选举
7. 进入sched.Run()

如果informer中的cache同步完成后, 循环调用scheduleOne
```
// Run begins watching and scheduling. It waits for cache to be synced, then starts a goroutine and returns immediately.
func (sched *Scheduler) Run() {
	if !sched.config.WaitForCacheSync() {
		return
	}

	go wait.Until(sched.scheduleOne, 0, sched.config.StopEverything)
}
```

scheduleOne函数的过程：
1. 在执行调度循环的开始阶段移除所有插件上下文
2. 从调度队列中取出一个pod，如果pod处于删除状态或调度队列关闭，则直接返回
3. 执行sched.schedule(pod), 通过预选和打分过程过滤返回得分最高的节点
4. 上述过程执行失败的话即没有返回合适的节点，判断是否开启抢占机制，是即执行
5. 是否需要volume调度
6. 执行reserve插件
7. 判断是否开启NodeName指定调度
8. 判断是否先绑定volume与host
9. 执行prebind插件
10. 绑定pod与host

第3步sched.schedule(pod)过程详解
```
// schedule implements the scheduling algorithm and returns the suggested result(host,
// evaluated nodes number,feasible nodes number).
func (sched *Scheduler) schedule(pod *v1.Pod) (core.ScheduleResult, error) {
	result, err := sched.config.Algorithm.Schedule(pod, sched.config.NodeLister)
	if err != nil {
		pod = pod.DeepCopy()
		sched.recordSchedulingFailure(pod, err, v1.PodReasonUnschedulable, err.Error())
		return core.ScheduleResult{}, err
	}
	return result, err
}
```

sched.config.Algorithm.Schedule, Algorithm是一个接口，包含4个方法：
```
// ScheduleAlgorithm is an interface implemented by things that know how to schedule pods
// onto machines.
// TODO: Rename this type.
type ScheduleAlgorithm interface {
	Schedule(*v1.Pod, algorithm.NodeLister) (scheduleResult ScheduleResult, err error)
	// Preempt receives scheduling errors for a pod and tries to create room for
	// the pod by preempting lower priority pods if possible.
	// It returns the node where preemption happened, a list of preempted pods, a
	// list of pods whose nominated node name should be removed, and error if any.
	Preempt(*v1.Pod, algorithm.NodeLister, error) (selectedNode *v1.Node, preemptedPods []*v1.Pod, cleanupNominatedPods []*v1.Pod, err error)
	// Predicates() returns a pointer to a map of predicate functions. This is
	// exposed for testing.
	Predicates() map[string]predicates.FitPredicate
	// Prioritizers returns a slice of priority config. This is exposed for
	// testing.
	Prioritizers() []priorities.PriorityConfig
}
```
genericScheduler是这个接口的具体实现

```
// Schedule tries to schedule the given pod to one of the nodes in the node list.
// If it succeeds, it will return the name of the node.
// If it fails, it will return a FitError error with reasons.
func (g *genericScheduler) Schedule(pod *v1.Pod, nodeLister algorithm.NodeLister) (result ScheduleResult, err error) {
	trace := utiltrace.New(fmt.Sprintf("Scheduling %s/%s", pod.Namespace, pod.Name))
	defer trace.LogIfLong(100 * time.Millisecond)
    // 检测pod pvc
	if err := podPassesBasicChecks(pod, g.pvcLister); err != nil {
		return result, err
	}
    // 获取节点列表
	nodes, err := nodeLister.List()
	if err != nil {
		return result, err
	}
	if len(nodes) == 0 {
		return result, ErrNoNodesAvailable
	}
    // 对缓存的NodeInfo map做快照
	if err := g.snapshot(); err != nil {
		return result, err
	}
    // 预选阶段
	trace.Step("Computing predicates")
	startPredicateEvalTime := time.Now()
	filteredNodes, failedPredicateMap, err := g.findNodesThatFit(pod, nodes)
	if err != nil {
		return result, err
	}

	if len(filteredNodes) == 0 {
		return result, &FitError{
			Pod:              pod,
			NumAllNodes:      len(nodes),
			FailedPredicates: failedPredicateMap,
		}
	}
	metrics.SchedulingAlgorithmPredicateEvaluationDuration.Observe(metrics.SinceInSeconds(startPredicateEvalTime))
	metrics.DeprecatedSchedulingAlgorithmPredicateEvaluationDuration.Observe(metrics.SinceInMicroseconds(startPredicateEvalTime))
	metrics.SchedulingLatency.WithLabelValues(metrics.PredicateEvaluation).Observe(metrics.SinceInSeconds(startPredicateEvalTime))
	metrics.DeprecatedSchedulingLatency.WithLabelValues(metrics.PredicateEvaluation).Observe(metrics.SinceInSeconds(startPredicateEvalTime))
    // 打分阶段
	trace.Step("Prioritizing")
	startPriorityEvalTime := time.Now()
	// When only one node after predicate, just use it.
	if len(filteredNodes) == 1 {
		metrics.SchedulingAlgorithmPriorityEvaluationDuration.Observe(metrics.SinceInSeconds(startPriorityEvalTime))
		metrics.DeprecatedSchedulingAlgorithmPriorityEvaluationDuration.Observe(metrics.SinceInMicroseconds(startPriorityEvalTime))
		return ScheduleResult{
			SuggestedHost:  filteredNodes[0].Name,
			EvaluatedNodes: 1 + len(failedPredicateMap),
			FeasibleNodes:  1,
		}, nil
	}

	metaPrioritiesInterface := g.priorityMetaProducer(pod, g.nodeInfoSnapshot.NodeInfoMap)
    // g.extenders就是scheduler extender框架扩展的自定义调度策略
	priorityList, err := PrioritizeNodes(pod, g.nodeInfoSnapshot.NodeInfoMap, metaPrioritiesInterface, g.prioritizers, filteredNodes, g.extenders)
	if err != nil {
		return result, err
	}
	metrics.SchedulingAlgorithmPriorityEvaluationDuration.Observe(metrics.SinceInSeconds(startPriorityEvalTime))
	metrics.DeprecatedSchedulingAlgorithmPriorityEvaluationDuration.Observe(metrics.SinceInMicroseconds(startPriorityEvalTime))
	metrics.SchedulingLatency.WithLabelValues(metrics.PriorityEvaluation).Observe(metrics.SinceInSeconds(startPriorityEvalTime))
	metrics.DeprecatedSchedulingLatency.WithLabelValues(metrics.PriorityEvaluation).Observe(metrics.SinceInSeconds(startPriorityEvalTime))

	trace.Step("Selecting host")
    // 选出分数最高的节点
	host, err := g.selectHost(priorityList)
	return ScheduleResult{
		SuggestedHost:  host,
		EvaluatedNodes: len(filteredNodes) + len(failedPredicateMap),
		FeasibleNodes:  len(filteredNodes),
	}, err
}
```

预选阶段实际调用的是findNodesThatFit函数
```
// 并发16个goroutine检查pod与node是否合适
	// Stops searching for more nodes once the configured number of feasible nodes
		// are found.
		workqueue.ParallelizeUntil(ctx, 16, int(allNodes), checkNode)

```

打分阶段调用的是PrioritizeNodes函数
```
// 并发16个goroutine统计节点打分
workqueue.ParallelizeUntil(context.TODO(), 16, len(nodes), func(index int)
```

### 扩展scheduler

添加新的调度策略是有三种方式：
1. 修改kube-scheduler源码，并重新编译它
2. 启动自定义的scheduler进程，和标准的kube-scheduler一起运行，一个集群支持运行多个scheduler; pod的
spec.schedulerName=random-scheduler标明使用的是哪个调度器
3. 使用Scheduler extender允许外部程序来过滤和打分节点，外部程序需要实现filter、prioritize操作，
也可以实现bind操作来达到pod与apiserver绑定(推荐)

方式2实现的代码范例：[https://github.com/yaoice/random-scheduler](https://github.com/yaoice/random-scheduler)

方式3实现的代码范例：[https://github.com/yaoice/sample-scheduler-extender](https://github.com/yaoice/sample-scheduler-extender)

scheduler extender也有局限性，所以k8s社区提出scheduler framework机制(v1.15), scheduler extender
的局限性在这里可以看到：[https://github.com/kubernetes/enhancements/blob/master/keps/sig-scheduling/20180409-scheduling-framework.md](https://github.com/kubernetes/enhancements/blob/master/keps/sig-scheduling/20180409-scheduling-framework.md)


### 参考链接

- [https://blog.tianfeiyu.com/source-code-reading-notes/kubernetes/kube_scheduler_algorithm.html](https://blog.tianfeiyu.com/source-code-reading-notes/kubernetes/kube_scheduler_algorithm.html)
- [https://banzaicloud.com/blog/k8s-custom-scheduler/](https://banzaicloud.com/blog/k8s-custom-scheduler/)
- [https://github.com/kubernetes/community/blob/master/contributors/design-proposals/scheduling/scheduler_extender.md](https://github.com/kubernetes/community/blob/master/contributors/design-proposals/scheduling/scheduler_extender.md)
- [https://developer.ibm.com/technologies/containers/articles/creating-a-custom-kube-scheduler/](https://developer.ibm.com/technologies/containers/articles/creating-a-custom-kube-scheduler/)