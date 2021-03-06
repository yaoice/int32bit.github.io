---
layout: post
title: K8s HPA
subtitle: HPA介绍(翻译)
catalog: true
tags:
     - k8s
---

引用来自k8s官网：[Horizontal Pod Autoscaler](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/#algorithm-details)

### HPA

Horizontal Pod Autoscaler根据观察到的CPU使用率（或使用自定义指标支持，基于某些其他应用程序提供的指标）
自动缩放replication controller，deployment，replica set或statefulset的pod数量. HPA不适用于DaemonSets.

Horizontal Pod Autoscaler被实现为Kubernetes API资源和控制器. 该资源决定控制器的行为. 
控制器会定期调整replication controller或deployment副本的数量，以使观察到的平均CPU利用率与用户指定的目标相匹配.

### HPA如何工作

<img src="/img/posts/2020-05-20/hpa.png"/>

Horizo​​ntal Pod Autoscaler被实现为一个控制循环，其周期由kube controller manager的--horizo​​ntal-pod-autoscaler-sync-period标志控制（默认值为15秒）.
在每个时间段，controller manager都会根据每个Horizo​​ntal Pod Autoscaler定义中指定的指标查询资源利用率. controller manager从资源指标API（针对每个pod资源指标）
或自定义指标API（针对所有其他指标）获取指标.

对于按pod资源指标（例如CPU），controller从资源metrics API中为Horizo​​ntalPodAutoscaler定位的每个pod获取指标. 如果设置了目标利用率，
则contrller计算利用率的值作为每个pod中的容器等价资源请求的百分比. 如果设置了目标原始值，则直接使用原始指标值.
controller将所有目标pod的利用率或原始值（取决于指定的目标类型）取平均值，并产生一个用于缩放所需副本数量的比率.

注：如果某些pod的容器未设置相关的资源请求，则不会定义容器的CPU使用率，并且autoscaler不会对该指标采取任何措施.

对于按pod自定义指标，controller的功能类似于按pod资源指标，不同之处在于它适用于原始值而非利用率值.

对于对象指标和外部指标，将获取单个指标，该指标描述了所讨论的对象。将该度量与目标值进行比较，以产生上述比率。在autoscaling/v2beta2 API版本中，
可以选择在进行比较之前将该值除以pod的数量.

Horizo​​ntalPodAutoscaler通常从一系列聚合的API（metrics.k8s.io，custom.metrics.k8s.io和external.metrics.k8s.io）中获取指标.
metrics.k8s.io API通常由metrics-server提供，需要单独启动。有关说明，请参见[metrics-server](https://kubernetes.io/docs/tasks/debug-application-cluster/resource-metrics-pipeline/#metrics-server).
Horizo​​ntalPodAutoscaler也可以直接从Heapster获取指标(heapster在Kubernetes 1.11后废弃).


#### HPA算法细节

从最基本的角度来看，Horizo​​ntal Pod Autoscaler controller以期望指标值与当前指标值之间的比率运行：
```
期望副本数 = ceil[当前副本数 * ( 当前指标值 / 期望指标值 )]
```
例如，如果当前指标值为200m，而期望指标值为100m，则副本数量将增加一倍，因为200.0 / 100.0 == 2.0. 
如果当前值为50m，我们会将副本数量减半，因为50.0 / 100.0 == 0.5. 如果该比例足够接近1.0（在--horizo​​ntal-pod-autoscaler-tolerance标志（默认为0.1）
的全局可配置容忍误差范围内），我们将跳过缩减.

如果指定了targetAverageValue或targetAverageUtilization时，currentMetricValue的计算方法是对
Horizo​​ntalPodAutoscaler缩减目标中所有Pod的给定指标取平均值. 但是，在检查容忍误差并确定最终值之前，我们会考虑pod readiness和缺少的指标.

所有设置了删除时间戳标记的Pod（即处于关闭状态的Pod）和所有失败的Pod将被丢弃.

如果特定Pod缺少指标，则将其保留以备后用；缺少指标的Pod将用于调整最终缩减比例.

在CPU上扩展时，如果有任何Pod尚未变成就绪状态（即它仍在initializing状态），或者Pod的最新指标值是在就绪状态之前，那么该Pod也将被保留.

由于技术限制，在确定是否预留某些CPU指标时，Horizo​​ntalPodAutoscaler controller无法准确确定Pod第一次准备就绪。
取而代之的是，如果Pod尚未就绪，并且在启动后的短短可配置时间内过渡为就绪，则认为Pod尚未就绪. 使用--horizo​​ntal-pod-autoscaler-initial-readiness-delay标志配置此值，其默认值为30秒。
一旦pod准备就绪后，如果它在自启动以来的较长的可配置时间内发生，则将任何时刻进入就绪状态的转换视为第一次.
使用--horizo​​ntal-pod-autoscaler-cpu-initialization-period标志配置此值，其默认值为5分钟.

使用未预留或未被丢弃的其余Pod计算currentMetricValue/desireMetricValue基本比例比率.

如果有任何缺失的指标，我们会更保守地重新计算平均值，假设在缩减的情况下，这些pod消耗了期望值的100％，在伸展的情况下消耗了0％。这抑制了任何潜在扩展的幅度。

此外，如果存在任何尚未进入就绪状态的pod，并且我们会在不考虑缺少指标或尚未进入就绪状态的pod的情况下进行扩展，则可以保守地假设尚未进入就绪状态的pod正在消耗期望指标的0％ ，进一步抑制伸展的幅度.

在考虑尚未进入就绪状态的pod和缺少的指标后，我们重新计算使用率. 如果新比例颠倒了缩减方向，或者在可容忍误差范围内，我们将跳过缩减. 否则，我们将使用新比例进行缩减.

注：即使使用新的使用率，平均利用率的原始值也会通过Horizo​​ntalPodAutoscaler状态报告回去，而不会考虑尚未进入就绪状态的pod或缺少指标值.

如果在Horizo​​ntalPodAutoscaler中指定了多个指标，则将对每个指标进行此计算，然后选择所需副本数中的最大值.
如果这些指标中的任何一个都不能转换为期望的副本计数（例如，由于从metrics API提取指标时出错），并且从可获取的指标中被建议按比例缩减，则跳过按比例缩减.
这意味着，如果一个或多个指标提供的期望副本数大于当前值，则HPA仍能够进行扩展.

最后，在HPA缩减目标之前，就记录了缩减建议. controller考虑可配置窗口中的所有建议，从该窗口中选择最好建议. 
可以使用--horizo​​ntal-pod-autoscaler-downscale-stabilization标志（默认为5分钟）来配置此值. 这意味着缩减将逐渐发生，以消除快速波动的指标值的影响.


### API对象

Horizontal Pod Autoscaler是Kubernetes autoscaling的API组. 当前的稳定版本仅包含对CPU autoscaling的支持，可以在autoscaling/v1 API版本中找到.

beta版本包含对内存扩展和自定义指标的支持，可以在autoscaling/v2beta2中找到. 在使用autoscaling/v1时，autoscaling/v2beta2中引入的新字段将保留为annotations.
v1(仅支持CPU指标),v2beta1(支持CPU和Memory和自定义指标(Pods、Objects))，v2beta2 支持外部接口定义指标(External)

创建HorizontalPodAutoscaler API对象时，请确保指定的名称是有效的[DNS子域名](https://kubernetes.io/docs/concepts/overview/working-with-objects/names#dns-subdomain-names).
有关API对象的更多详细信息，请参见[HorizontalPodAutoscaler](https://git.k8s.io/community/contributors/design-proposals/autoscaling/horizontal-pod-autoscaler.md#horizontalpodautoscaler-object)对象。


### kubectl支持HPA

像每个API资源一样，kubectl以标准方式支持Horizontal Pod Autoscaler。 我们可以使用kubectl create命令创建一个新的自动缩放器。
我们可以通过kubectl get hpa列出自动定标器，并通过kubectl describe hpa获取详细描述。 最后，我们可以使用kubectl delete hpa删除自动定标器。

此外，还有一个特殊的kubectl自动伸缩命令，可轻松创建Horizontal Pod Autoscaler. 
例如，执行```kubectl autoscale rs foo --min=2 --max=5 --cpu-percent=80```
将为replication set foo创建一个自动缩放器，目标CPU利用率设置为80％，副本数在2到5之间.

### 滚动更新期间自动缩放

当前在Kubernetes中，可以使用deployment对象执行滚动更新，该deployment对象为你管理基础副本集. 
Horizontal Pod Autoscaler仅支持后一种方法：Horizontal Pod Autoscaler绑定到deployment对象，
它设置deployment对象的大小，并且deployment负责设置基础副本集的大小.

Horizontal Pod Autoscaler不适用于通过直接操作副本控制器进行滚动更新的功能，即你无法将Horizontal Pod Autoscaler
绑定到副本控制器并进行滚动更新。 这样做不起作用的原因是，当滚动更新创建新的副本控制器时，Horizontal Pod Autoscaler不会绑定到新的副本控制器.


### 支持冷却和延迟

使用Horizontal Pod Autoscaler管理一组副本的规模时，由于所评估指标的动态性质，副本的数量可能会经常波动. 有时将其称为抖动.

从v1.6开始，集群操作员可以通过调整作为kube-controller-manager组件的标志公开的全局HPA设置来缓解此问题：

从v1.12开始，新的算法更新消除了对高级延迟的需求.

--horizontal-pod-autoscaler-downscale-stabilization：此选项的值是一个持续时间，用于指定在当前操作完成后，
autoscaler必须等待多长时间才能执行另一次缩放操作。 默认值为5分钟（5m0s）。

### 支持多种指标

Kubernetes 1.6增加了对基于多个指标进行扩展的支持. 您可以使用autoscaling/v2beta2 API版本为Horizontal Pod Autoscaler指定要扩展的多个指标. 
然后Horizontal Pod Autoscaler控制器将评估每个指标，并根据该指标提出新的扩展. 提议的最大扩展将用作新扩展.

### 支持自定义指标

Kubernetes 1.6增加了对在Horizontal Pod Autoscaler中使用自定义指标的支持. 你可以为Horizontal Pod Autoscaler添加自定义指标，
以在autoscaling/v2beta2 API中使用. 然后Kubernetes查询新的自定义指标API，以获取适当的自定义指标的值.

### 支持指标API

默认情况下，Horizo​​ntal Pod Autoscaler控制器从一系列API中检索指标。为了使其能够访问这些API，集群管理员必须确保：

- 已启用[API聚合层](https://kubernetes.io/docs/tasks/access-kubernetes-api/configure-aggregation-layer/)。

- 相应的API已注册：

    - 对于资源指标，通常是由metrics-server提供的metrics.k8s.io API。它可以作为集群附件启动。

    - 对于自定义指标，这是custom.metrics.k8s.io API。它由指标解决方案供应商提供的“适配器” API服务器提供。检查您的指标管道或[已知解决方案列表](https://github.com/kubernetes/metrics/blob/master/IMPLEMENTATIONS.md#custom-metrics-api)。如果您想编写自己的内容，请查看样板以开始使用。

    - 对于外部指标，这是external.metrics.k8s.io API。它可以由上面提供的自定义指标适配器提供。

- --horizo​​ntal-pod-autoscaler-use-rest-clients为真或未设置。将此选项设置为false会切换到基于Heapster的自动缩放，已废弃.


### 支持可配置的伸缩行为

从v1.18开始，v2beta2 API允许通过HPA behavior字段配置扩展行为.
在behavior字段下的scaleUp或scaleDown部分中分别指定了用于按比例放大和缩小的行为. 
可以在两个方向上指定一个稳定窗口，以防止伸缩目标中的副本数量出现波动. 同样，指定伸缩策略可控制伸缩时副本的变化率.

#### 伸缩策略

可以在规范的behavior部分中指定一种或多种伸缩策略. 当指定了多个策略时，默认选择的是允许更改量最大的策略.
以下示例显示了按比例缩减时的behavior：
```
behavior:
  scaleDown:
    policies:
    - type: Pods
      value: 4
      periodSeconds: 60
    - type: Percent
      value: 10
      periodSeconds: 60
```

当Pod的数量超过40个时, 将使用第二个策略进行缩减. 例如，如果有80个副本, 并且目标必须缩减到10个副本, 则在第一步期间将减少8个副本. 
在下一个迭代中，当副本数为72时，有10％的Pod为7.2，但是四舍五入为8。在autoscaler控制器的每个循环上，
将根据数量重新计算要更改的Pod的数量。当前副本。当副本数降到40以下时，将应用第一个policy_（Pods）_，并且一次将减少4个副本.

periodSeconds表示该策略必须满足的过去时间长度。第一项策略允许在一分钟内最多缩减4个副本. 第二种策略允许一分钟内最多缩减10％的当前副本.

可以通过为扩展方向指定selectPolicy字段来更改策略选择. 通过将值设置为Min，可以选择允许副本数量最小变化的策略. 将值设置为Disabled将完全禁用该方向的缩减.


#### 稳定窗

当用于伸缩的指标持续波动时，稳定窗口用于限制副本的摆动. 自动缩放算法使用稳定窗口来考虑过去计算的期望状态以防止伸缩. 在以下示例中，为scaleDown指定了稳定窗口.
```
scaleDown:
  stabilizationWindowSeconds: 300
```
当指标指示目标应按比例缩减时，算法将查看先前计算的期望状态，并使用指定间隔中的最大值。在上面的示例中，将考虑过去5分钟内的所有期望状态.

#### 默认行为

要使用自定义伸缩比例，不必指定所有字段. 只能指定需要自定义的值. 这些自定义值与默认值合并. 默认值与HPA算法中的现有behavior匹配.
```
behavior:
  scaleDown:
    stabilizationWindowSeconds: 300
    policies:
    - type: Percent
      value: 100
      periodSeconds: 15
  scaleUp:
    stabilizationWindowSeconds: 0
    policies:
    - type: Percent
      value: 100
      periodSeconds: 15
    - type: Pods
      value: 4
      periodSeconds: 15
    selectPolicy: Max
```
缩小稳定窗口的时间为300秒（或提供的--horizontal-pod-autoscaler-downscale-stabilization标志的值）。 只有一个用于缩减的策略，该策略允许删除100％当前运行的副本，这意味着可以将缩减目标缩减到允许的最小副本。 
为了扩大规模，没有稳定窗口。 当度量标准指示应按比例扩大目标时，即会立即按比例扩大目标。 
有2条政策。 每15秒将添加4个Pod或当前运行的副本的100％，直到HPA达到稳定状态。

#### 范例：更改缩减稳定窗口

为了提供1分钟的自定义降级稳定窗口，将在HPA中添加以下行为：
```
behavior:
  scaleDown:
    stabilizationWindowSeconds: 60
```


#### 范例: 限制缩减速率

为了将HPA移除pod的速率限制为每分钟10％，HPA将添加以下行为：
```
behavior:
  scaleDown:
    policies:
    - type: Percent
      value: 10
      periodSeconds: 60
```

要允许最后丢弃5个pod，可以添加另一个策略和一个最小选择策略：
```
behavior:
  scaleDown:
    policies:
    - type: Percent
      value: 10
      periodSeconds: 60
    - type: Pods
      value: 5
      periodSeconds: 60
    selectPolicy: Max
```

#### 范例：禁用缩减

selectPolicy值的Disabled禁用缩减给定方向。 因此，为了防止规模缩减，将使用以下策略：
```
behavior:
  scaleDown:
    selectPolicy: Disabled
```

### HPA演练

#### 前提

部署metric-server在k8s集群中, metric-serves是k8s监控架构中的一个组件.

<img src="/img/posts/2020-05-20/k8s-monitoring-architecture.png"/>
引用来自：[Kubernetes monitoring architecture](https://github.com/kubernetes/community/blob/master/contributors/design-proposals/instrumentation/monitoring_architecture.md)`

部署metric-server
```
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.3.6/components.yaml
```

验证metric-server
```
# curl -H 'Authorization: Bearer 1aYiwwOnSN4Yk5oNm7fov0ohBbk' \
        -k \
        https://<metric-server-svc>/apis/metrics.k8s.io/v1beta1/namespaces/tcnp/pods/cluster-console-7855bf5575-7frb2
```

metric-server获取不到pod metric参考这里：[https://www.jianshu.com/p/5fe108d70310](https://www.jianshu.com/p/5fe108d70310)
```
      containers:
      - name: metrics-server
        image: k8s.gcr.io/metrics-server-amd64:v0.3.6
        imagePullPolicy: IfNotPresent
        args:
          - --cert-dir=/tmp
          - --secure-port=4443
          - --kubelet-insecure-tls        #增加，忽略tls
          - --kubelet-preferred-address-types=InternalIP  #增加，使用内部IP
```

#### 运行一个php-apache服务

```
# kubectl apply -f https://k8s.io/examples/application/php-apache.yaml
deployment.apps/php-apache created
service/php-apache created
```

#### 创建HPA

```
# kubectl autoscale deployment php-apache --cpu-percent=50 --min=1 --max=10
horizontalpodautoscaler.autoscaling/php-apache autoscaled
```

```
# kubectl get hpa
NAME         REFERENCE               TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
php-apache   Deployment/php-apache   0%/50%    1         10        1          68m
```

#### 增加负载压测

启动一个busybox的容器，循环调用
```
# kubectl run -it --rm load-generator --image=busybox /bin/sh
kubectl run --generator=deployment/apps.v1 is DEPRECATED and will be removed in a future version. Use kubectl run --generator=run-pod/v1 or kubectl create instead.

If you don't see a command prompt, try pressing enter.
/ # 
/ # while true; do wget -q -O- http://php-apache; done
OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!OK!
OK!OK!OK!OK!OK!^C
```
大概1分钟左右，php-apache的负载就会上升

```
# kubectl get hpa
NAME         REFERENCE               TARGETS    MINPODS   MAXPODS   REPLICAS   AGE
php-apache   Deployment/php-apache   249%/50%   1         10        5          72m
```

#### 停止负载压测

终止busybox的容器
```
# kubectl get hpa
NAME         REFERENCE               TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
php-apache   Deployment/php-apache   0%/50%    1         10        1          121m
```
副本数回到1了


#### 基于多个指标

生成autoscaling/v2beta2 api的sample yaml
```
# kubectl get hpa.v2beta2.autoscaling -o yaml > /tmp/hpa-v2.yaml
```

kubectl autoscale默认使用的是autoscaling/v1版本，编辑hpa-v2.yaml使用autoscaling/v2beta2
```
[root@ice ~]# vim hpa-v2.yaml 
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  name: php-apache
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: php-apache
  minReplicas: 1
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 50
```
具体API的定义跟v1有区别

继续上面的负载压测操作，看是否生效
```
# kubectl get hpa
NAME         REFERENCE               TARGETS    MINPODS   MAXPODS   REPLICAS   AGE
php-apache   Deployment/php-apache   250%/50%   1         10        5          5m55s
```
有起作用

基于cpu和内存的指标
```
# vim hpa-v2.yaml 
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  name: php-apache
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: php-apache
  minReplicas: 1
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 50
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 50
```
为deployment php-apache加上resources.requests.memory

```
# kubectl get hpa
NAME         REFERENCE               TARGETS          MINPODS   MAXPODS   REPLICAS   AGE
php-apache   Deployment/php-apache   0%/60%, 0%/50%   1         10        1          10m
```

三个指标的hpa
```
# vim hpa-v2-3-metrics.yaml
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  name: php-apache
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: php-apache
  minReplicas: 1
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 50
  - type: Pods
    pods:
      metric:
        name: packets-per-second
      target:
        type: AverageValue
        averageValue: 1k
  - type: Object
    object:
      metric:
        name: requests-per-second
      describedObject:
        apiVersion: networking.k8s.io/v1beta1
        kind: Ingress
        name: main-route
      target:
        type: Value
        value: 10k
```
HPA确保每个pod消耗其所需要的cpu的50%，每秒1000包，ingress后面的所有pod每秒10000请求

```
# kubectl apply -f hpa-v2-3-metrics.yaml 
horizontalpodautoscaler.autoscaling/php-apache created
```

#### 更多特定的指标

采集GET请求的http请求数
```
type: Object
object:
  metric:
    name: http_requests
    selector: {matchLabels: {verb: GET}}
```

#### 和k8s对象不关联的指标

```
- type: External
  external:
    metric:
      name: queue_messages_ready
      selector: "queue=worker_tasks"
    target:
      type: AverageValue
      averageValue: 30
```
使用selector来匹配时间序列的值

#### HPA状态情况

```
kubectl describe hpa
```
通过describe hpa的status.conditions字段可以看出autoscaling的过程
