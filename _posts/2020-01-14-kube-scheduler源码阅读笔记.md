---
layout: post
title: kube-scheduler源码阅读笔记
subtitle: ""
catalog: true
hide: true
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
```

启动过程最终调用Run函数，Run函数过程：
1. 初始化scheduler实例
2. 准备事件广播
3. 建立健康检查
4. 启动健康检查api
5. 启动所有informer
6. 是否开启选举
7. 进入sched.Run()



### 参考链接

- [https://github.com/kubernetes/kubernetes/issues/61937](https://github.com/kubernetes/kubernetes/issues/61937)
- [https://tencentcloudcontainerteam.github.io/2018/12/29/cgroup-leaking/?nsukey=VOA6Ga0MWGzmiqZAw%2F8WzLptJWfcnMMDuP3F2KP3qm18ZVlcabhFQBnNpFnPc1V8tjh6kNsK%2Bjsw9l5Og35a6hbOobAkkJLfIAZ8blfi0keARy%2FGM6RZBd0wZvEtyMFtu0k7XYfyiuzECgizSxQER%2F4JerJEZkfd7RcBdNHCxdVps7IGcQQ9UyfM8oSYTlNUQD8wphVnSTxHJVG4I5e7Wg%3D%3D](https://tencentcloudcontainerteam.github.io/2018/12/29/cgroup-leaking/?nsukey=VOA6Ga0MWGzmiqZAw%2F8WzLptJWfcnMMDuP3F2KP3qm18ZVlcabhFQBnNpFnPc1V8tjh6kNsK%2Bjsw9l5Og35a6hbOobAkkJLfIAZ8blfi0keARy%2FGM6RZBd0wZvEtyMFtu0k7XYfyiuzECgizSxQER%2F4JerJEZkfd7RcBdNHCxdVps7IGcQQ9UyfM8oSYTlNUQD8wphVnSTxHJVG4I5e7Wg%3D%3D)
- [https://www.jianshu.com/p/033fe2518476](https://www.jianshu.com/p/033fe2518476)