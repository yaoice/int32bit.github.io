---
layout: post
title: TKEStack
subtitle: TAPP源码阅读笔记
catalog: true
hide: true
tags:
- tkestack
---

## TAPP

### 1 TAPP是什么

>TAPP是一种新的k8s应用负载，基于CRD实现，它同时包含kubernetes`deployment`和`statefulset`的大多数特性， 
>并且用户可以轻松在Kubernetes上运行遗留应用程序。当前许多用户希望采用Kubernetes，并将其旧版应用程序迁移到Kubernetes。
>但是他们不能直接使用Kubernetes的工作负载（例如，`deployment`，`statefulset`），因此将这些应用程序转换为微服务将需要大量的努力。
>Tapp可以解决这些问题。

### 2 TAPP特性

- 支持每个pod的唯一索引，(与`statefulset`相同)
  
- 支持在特定实例(pod)上执行启动/停止/升级操作
  
     它更适合传统的操作和维护，例如当管理员想要停止一台计算机时，他可以停止该计算机上的实例，而不会影响其他计算机上的实例。
  
- 支持实例的就地更新
  
     尽管许多无状态工作负载可以容忍非就地更新，但不排除某些应用很敏感，毕竟Pod重新启动是一种比较极端的方式，导致较低的可用性或较高的运行成本。

- 支持多种版本的实例

     实例使用不同的镜像或不同的配置。

- 支持HPA，根据多种指标（例如CPU，内存，自定义指标）

- 支持滚动更新，回滚

### 3 TAPP使用

#### 3.1 编译tapp-controller

```
~/go_workspace/src/tkestack.io/tapp# make build
hack/build.sh
Build success!
```

命令行运行tapp-controller
```
root@xiabingyao-LC0:~/go_workspace/src/tkestack.io/tapp# bin/tapp-controller --kubeconfig=/root/.kube/config
I0121 15:07:41.615902 3726361 controller.go:155] Setting up event handlers
I0121 15:07:41.644437 3726361 controller.go:196] Starting tapp controller
I0121 15:07:41.644466 3726361 controller.go:199] Waiting for informer caches to sync
E0121 15:07:41.646686 3726361 reflector.go:126] pkg/mod/k8s.io/client-go@v11.0.1-0.20191029005444-8e4128053008+incompatible/tools/cache/reflector.go:94: Failed to list *v1.TApp: the server could not find the requested resource (get tapps.apps.tkestack.io)
I0121 15:07:42.744715 3726361 controller.go:204] Starting workers
I0121 15:07:42.744775 3726361 controller.go:210] Started workers
```
创建tapp crd的过程也定义在tapp-controller代码中，一启动自动创建好了

#### 3.2 创建tapp对象 

#### 3.2.1 使用同样的template

创建example-tapp tapp cr
```
kubectl apply -f - << EOF
apiVersion: apps.tkestack.io/v1
kind: TApp
metadata:
  name: example-tapp
  namespace: test
spec:
  replicas: 3
  template:
    metadata:
      labels:
        app: example-tapp
    spec:
      containers:
      - name: nginx
        image: nginx:1.7.9
EOF
```

#### 3.2.2 使用不一样的template

```
kubectl apply -f - << EOF
apiVersion: apps.tkestack.io/v1
kind: TApp
metadata:
  name: example-tapp
  namespace: test
spec:
  replicas: 3
  template:
    metadata:
      labels:
        app: example-tapp
    spec:
      containers:
      - name: nginx
        image: nginx:1.8.1
  templatePool:
    "test":
      metadata:
        labels:
          app: example-tapp
      spec:
        containers:
        - name: nginx
          image: nginx:1.7.9
  templates:
    "1": "test"
#  defaultTemplateName: "test"
EOF
```
tapp新增了多个字段以支持更多的特性，`spec.templatePools`、`spec.templates`和`defaultTemplateName`
- `spec.templatePools`来声明template
- `spec.templates`指定pod使用哪个template，如果没指定，默认使用default template
- 在`spec.templatePools`中使用`spec.DefaultTemplateName`来设置default template，
  如果未设置的话，`spec.template`作为default template.
  
#### 3.3 查询tapp对象 

查看tapp资源列表
```
~/go_workspace/src/tkestack.io/tapp# kubectl -n test get tapps.apps.tkestack.io 
NAME           AGE
example-tapp   72s
```

查看tapp资源描述
```
~/go_workspace/src/tkestack.io/tapp# kubectl descirbe tapp tapps.apps.tkestack.io example-tapp
```

查看pod
```
~/go_workspace/src/tkestack.io/tapp# kubectl -n test get pod 
NAME             READY   STATUS    RESTARTS   AGE
example-tapp-0   1/1     Running   0          73s
example-tapp-1   1/1     Running   0          73s
example-tapp-2   1/1     Running   0          73s
```

#### 3.4 更新tapp对象

如果仅更新容器的映像，则Tapp控制器将对Pod进行就地更新，否则它将删除Pod并重新创建它们.

#### 3.4.1 更新特定的pod

```
kubectl apply -f - << EOF
apiVersion: apps.tkestack.io/v1
kind: TApp
metadata:
  name: example-tapp
  namespace: test
spec:
  replicas: 3
  template:
    metadata:
      labels:
        app: example-tapp
    spec:
      containers:
      - name: nginx
        image: nginx:latest
  templatePool:
    "test2":
      metadata:
        labels:
          app: example-tapp
      spec:
        containers:
        - name: nginx
          image: nginx:1.8.1
  templates:
     "1": "test2"
EOF
```
指定pod-xxx-1使用test2的`spec.templatePool`, pod是并发更新的

#### 3.4.2 滚动更新

```
kubectl apply -f - << EOF
apiVersion: apps.tkestack.io/v1
kind: TApp
metadata:
  name: example-tapp
  namespace: test
spec:
  replicas: 3
  template:
    metadata:
      labels:
        app: example-tapp
    spec:
      containers:
      - name: nginx
        image: nginx:latest
  templatePool:
    "test2":
      metadata:
        labels:
          app: example-tapp
      spec:
        containers:
        - name: nginx
          image: nginx:1.7.9
  templates:
    "1": "test2"
    "2": "test2"
  updateStrategy:
    template: test2
    maxUnavailable: 1
EOF
```
- 使用`spec.updateStrategy`指定滚动更新template
- 使用`spec.updateStrategy.maxUnavailable`指定更新过程中最大可容忍不可用的pod数量，可以是整数或百分比;
  默认值为1

#### 3.5 杀死特定pod

```
kubectl apply -f - << EOF
apiVersion: apps.tkestack.io/v1
kind: TApp
metadata:
  name: example-tapp
  namespace: test
spec:
  replicas: 3
  template:
    metadata:
      labels:
        app: example-tapp
    spec:
      containers:
      - name: nginx
        image: nginx:latest
  templatePool:
    "test2":
      metadata:
        labels:
          app: example-tapp
      spec:
        containers:
        - name: nginx
          image: nginx:1.7.9
  templates:
    "1": "test2"
  statuses:
    "1": "Killed"
EOF
```
使用`spec.statuses`可以指定pod的状态，上面例子指定pod-xxx-1被tapp controller kill掉；如果想再次运行pod-xxx-1，移除`spec.statuses`即可

#### 3.6 扩缩容tapp

使用什么样的template，跟上面【创建tapp对象】【使用不一样的template】章节方式一致，`kubectl scale`命令同样适用于
tapp
```
~/go_workspace/src/tkestack.io/tapp# kubectl -n test scale --replicas=4 tapps.apps.tkestack.io example-tapp
```

#### 3.7 Headless service

Tapp支持statefulset headless service方式，每个pod的subdomain: $(podname).$(namespace).svc.cluster.local, 
如cluster domain是"cluster.local"
```
kubectl apply -f - << EOF
 apiVersion: v1
  kind: Service
  metadata:
    name: nginx
    namespace: test
    labels:
      app: example-tapp
  spec:
    ports:
    - port: 80
      name: web
    clusterIP: None
    selector:
      app: example-tapp
---
  apiVersion: apps.tkestack.io/v1
  kind: TApp
  metadata:
    name: example-tapp
    namespace: test
  spec:
    replicas: 3
    serviceName: "nginx"
    template:
      metadata:
        labels:
          app: example-tapp
      spec:
        containers:
        - name: nginx
          image: nginx:1.7.9
EOF
```

#### 3.8 删除unused template

通过设置`spec.autoDeleteUnusedTemplate`为true，可以删除未被使用的template，来使tapp对象内容更简洁
```
kubectl apply -f - << EOF
  apiVersion: apps.tkestack.io/v1
  kind: TApp
  metadata:
    name: example-tapp
    namespace: test
  spec:
    replicas: 3
    autoDeleteUnusedTemplate: true
    template:
      metadata:
        labels:
          app: example-tapp
      spec:
        containers:
        - name: nginx
          image: nginx:1.7.9
    templatePool:
      "test1":
        metadata:
          labels:
            app: example-tapp
        spec:
          containers:
          - name: nginx
            image: nginx:1.7.9
      "test2":
        metadata:
          labels:
            app: example-tapp
        spec:
          containers:
          - name: nginx
            image: nginx:1.7.8
      "test3":
        metadata:
          labels:
            app: example-tapp
        spec:
          containers:
          - name: nginx
            image: nginx:1.7.7
      "test4":
        metadata:
          labels:
            app: example-tapp
        spec:
          containers:
          - name: nginx
            image: nginx:1.7.7
    templates:
      "1": "test1"
    updateStrategy:
      template: "test3"
      maxUnavailable: 1
    DefaultTemplateName: "test4"
EOF
```

#### 3.9 tapp with volume

```
kubectl apply -f - << EOF
apiVersion: apps.tkestack.io/v1
kind: TApp
metadata:
  name: example-tapp
  namespace: test
spec:
  replicas: 2
  template:
    metadata:
      labels:
        app: example-tapp
    spec:
      containers:
      - name: nginx
        image: nginx:1.7.9
        volumeMounts:
        - name: www
          mountPath: /usr/share/nginx/html
  volumeClaimTemplates:
  - metadata:
      name: www
      labels:
        app: example-tapp
    spec:
      accessModes: [ "ReadWriteOnce" ]
      storageClassName: rbd
      resources:
        requests:
          storage: 10Gi
EOF          
```

#### 3.10 删除tapp

```
# kubectl -n test delete tapps.apps.tkestack.io example-tapp
```

#### 3.11 清理tapp

```
# kubectl delete crd tapps.apps.tkestack.io
```

### 4 代码分析

#### 4.1 结构体

#### 4.1.1 TApp
```
// TApp represents a set of pods with consistent identities.
type TApp struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// Spec defines the desired identities of pods in this tapp.
	Spec TAppSpec `json:"spec,omitempty"`

	// Status is the current status of pods in this TApp. This data
	// may be out of date by some window of time.
	Status TAppStatus `json:"status,omitempty"`
}
```

#### 4.1.2 TAppSpec
```
// A TAppSpec is the specification of a TApp.
type TAppSpec struct {
	// Replicas is the desired number of replicas of the given Template.
	// These are replicas in the sense that they are instantiations of the
	// same Template, but individual replicas also have a consistent identity.
	Replicas int32 `json:"replicas"`

	// Selector is a label query over pods that should match the replica count.
	// If empty, defaulted to labels on the pod template.
	// More info: http://releases.k8s.io/release-1.4/docs/user-guide/labels.md#label-selectors
	Selector *metav1.LabelSelector `json:"selector,omitempty"`

	// Template is the object that describes the pod that will be initial created/default scaled
	// it should be added to TemplatePool
	Template corev1.PodTemplateSpec `json:"template"`

	// TemplatePool stores a map whose key is template name and value is podTemplate
	TemplatePool map[string]corev1.PodTemplateSpec `json:"templatePool,omitempty"`

	// Statuses stores desired instance status instanceID --> desiredStatus
	Statuses map[string]InstanceStatus `json:"statuses,omitempty"`

	// Templates stores instanceID --> template name
	Templates map[string]string `json:"templates,omitempty"`

	// UpdateStrategy indicates the TappUpdateStrategy that will be
	// employed to update Pods in the TApp
	UpdateStrategy TAppUpdateStrategy `json:"updateStrategy,omitempty"`

	// ForceDeletePod indicates whether force delete pods when it is being deleted because of NodeLost.
	// Default values is false.
	ForceDeletePod bool `json:"forceDeletePod,omitempty"`

	// AutoDeleteUnusedTemplate indicates whether auto delete templates when it is unused.
	// Default values is false.
	AutoDeleteUnusedTemplate bool `json:"autoDeleteUnusedTemplate,omitempty"`

	// NeverMigrate indicates whether to migrate pods. If it is true, pods will never be migrated to
	// other nodes, otherwise it depends on other conditions(e.g. pod restart policy).
	NeverMigrate bool `json:"neverMigrate,omitempty"`

	// volumeClaimTemplates is a list of claims that pods are allowed to reference.
	// The StatefulSet controller is responsible for mapping network identities to
	// claims in a way that maintains the identity of a pod. Every claim in
	// this list must have at least one matching (by name) volumeMount in one
	// container in the template. A claim in this list takes precedence over
	// any volumes in the template, with the same name.
	// TODO: Define the behavior if a claim already exists with the same name.
	VolumeClaimTemplates []corev1.PersistentVolumeClaim `json:"volumeClaimTemplates,omitempty"`

	// ServiceName is the name of the service that governs this TApp.
	// This service must exist before the TApp, and is responsible for
	// the network identity of the set. Pods get DNS/hostnames that follow the
	// pattern: pod-specific-string.serviceName.default.svc.cluster.local
	// where "pod-specific-string" is managed by the TApp controller.
	ServiceName string `json:"serviceName,omitempty"`

	//DefaultTemplateName is the default template name for scale
	DefaultTemplateName string `json:"defaultTemplateName"`
}
```

#### 4.1.3 TAppUpdateStrategy
```
// TApp update strategy
type TAppUpdateStrategy struct {
	// Following fields are rolling update related configuration.
	// Template is the rolling update template name
	Template string `json:"template,omitempty"`
	// MaxUnavailable is the max unavailable number when tapp is rolling update, default is 1.
	MaxUnavailable *intstr.IntOrString `json:"maxUnavailable,omitempty"`

	// Following fields are force update related configuration.
	ForceUpdate ForceUpdateStrategy `json:"forceUpdate,omitempty"`
}
```

#### 4.1.4 ForceUpdateStrategy
```
type ForceUpdateStrategy struct {
	// MaxUnavailable is the max unavailable number when tapp is forced update, default is 100%.
	MaxUnavailable *intstr.IntOrString `json:"maxUnavailable,omitempty"`
}
```

#### 4.1.5 TAppStatus
```
type InstanceStatus string

const (
	InstanceNotCreated InstanceStatus = "NotCreated"
	InstancePending    InstanceStatus = "Pending"
	InstanceRunning    InstanceStatus = "Running"
	InstanceUpdating   InstanceStatus = "Updating"
	InstancePodFailed  InstanceStatus = "PodFailed"
	InstancePodSucc    InstanceStatus = "PodSucc"
	InstanceKilling    InstanceStatus = "Killing"
	InstanceKilled     InstanceStatus = "Killed"
	InstanceFailed     InstanceStatus = "Failed"
	InstanceSucc       InstanceStatus = "Succ"
	InstanceUnknown    InstanceStatus = "Unknown"
)

type AppStatus string

const (
	AppPending AppStatus = "Pending"
	AppRunning AppStatus = "Running"
	AppFailed  AppStatus = "Failed"
	AppSucc    AppStatus = "Succ"
	AppKilled  AppStatus = "Killed"
)

// TAppStatus represents the current state of a TApp.
type TAppStatus struct {
	// most recent generation observed by controller.
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`

	// Replicas is the number of actual replicas.
	Replicas int32 `json:"replicas"`

	// ReadyReplicas is the number of running replicas
	ReadyReplicas int32 `json:"readyReplicas"`

	// ScaleSelector is a label for query over pods that should match the replica count used by HPA.
	ScaleLabelSelector string `json:"scaleLabelSelector,omitempty"`

	// AppStatus describe the current TApp state
	AppStatus AppStatus `json:"appStatus,omitempty"`

	// Statues stores actual instanceID --> InstanceStatus
	Statuses map[string]InstanceStatus `json:"statuses,omitempty"`
}
```

#### 4.1.6 TAppStatus
```
// TAppList is a collection of TApp.
type TAppList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []TApp `json:"items"`
}
```

#### 4.1.7 Instance
```
// instance is the control block used to transmit all updates about a single instance.
// It serves as the manifest for a single instance. Users must populate the pod
// and parent fields to pass it around safely.
type Instance struct {
	// pod is the desired pod.
	pod *corev1.Pod
	// id is the identity index of this instance.
	id string
	// parent is a pointer to the parent tapp.
	parent *tappv1.TApp
}
```

#### 原地升级实现原理

pod标签中有两种hash

- template hash(spec.template)
- uniq hash(container和initContainer部分中不包括image)

原地升级条件：template hash发生改变，uniq hash没改变 -> 替换pod的镜像


### 参考链接

- [https://github.com/tkestack/tapp](https://github.com/tkestack/tapp)




