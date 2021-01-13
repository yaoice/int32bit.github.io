---
layout: post
title: TKEStack
subtitle: tke-platform-controller健康检查
catalog: true
tags:
     - tkestack
---

### 环境

tke版本: v0.12.2

### 现象

#### Cluster对象错误日志

集群HealthCheck失败，集群状态为Failed, 且不会再恢复
```
# kubectl --kubeconfig=/etc/tke/tke-platform-config.yaml get cluster  cls-bd46179d -o yaml

  - lastProbeTime: "2020-09-09T11:40:27Z"
    lastTransitionTime: "2020-09-09T11:40:27Z"
    message: '1Get https://192.168.55.14:6443/api/v1/pods?limit=500: dial tcp 192.168.55.14:6443:
      connect: connection refused'
    reason: HealthCheckFail
    status: "False"
    type: HealthCheck
  - lastProbeTime: "2020-09-08T07:50:15Z"
    lastTransitionTime: "2020-09-08T07:50:15Z"
    status: "True"
    type: SyncVersion
  dnsIP: 172.20.252.10
  nodeCIDRMaskSize: 24
  phase: Failed
```

#### tke-platform-controller错误日志 

查看tke-platform-controller日志，有大量的Throttling request，且耗时均在3s以上(另外一个开发环境耗时在ms级别)
```
# kubectl -n tke logs tke-platform-controller-666d645579-9pwq8 --tail 30
2020-09-10 03:08:40.504 info    Finished syncing machine        {"machineName": "mc-t2hbm6kt", "processTime": 0.10702}
2020-09-10 03:08:40.526 info    Throttling request took 3.644625512s, request: GET:https://tke-platform-api:9443/apis/platform.tke.cloud.tencent.com/v1/clustercredentials?fieldSelector=clusterName%3Dcls-bd46179d
2020-09-10 03:08:40.575 info    Throttling request took 3.650615986s, request: GET:https://tke-platform-api:9443/apis/platform.tke.cloud.tencent.com/v1/machines/mc-dplrj2hg
2020-09-10 03:08:40.625 info    Throttling request took 3.6304611s, request: GET:https://tke-platform-api:9443/apis/platform.tke.cloud.tencent.com/v1/machines/mc-lv8pmxnp
2020-09-10 03:08:40.675 info    Throttling request took 3.671669513s, request: GET:https://tke-platform-api:9443/apis/platform.tke.cloud.tencent.com/v1/clusters/cls-bd46179d
2020-09-10 03:08:40.725 info    Throttling request took 3.721528728s, request: GET:https://tke-platform-api:9443/apis/platform.tke.cloud.tencent.com/v1/clustercredentials?fieldSelector=clusterName%3Dcls-bd46179d
2020-09-10 03:08:40.775 info    Throttling request took 3.745508623s, request: GET:https://tke-platform-api:9443/apis/platform.tke.cloud.tencent.com/v1/clusters/cls-bd46179d
```

#### etcd错误日志

查看etcd日志，耗时差不多在200ms～300ms左右(另外一个开发环境耗时在100多ms)
```
# kubectl -n kube-system logs etcd-192.168.55.11  | grep "read-only range request"
2020-09-10 02:14:33.033138 W | etcdserver: read-only range request "key:\"/tke/platform/machines/mc-vhtmkkvs\" " with result "range_response_count:1 size:2869" took too long (256.009466ms) to execute
2020-09-10 02:14:33.033579 W | etcdserver: read-only range request "key:\"/tke/platform/machines/mc-bmd89j7v\" " with result "range_response_count:1 size:2869" took too long (106.963165ms) to execute
2020-09-10 02:14:33.033823 W | etcdserver: read-only range request "key:\"/tke/platform/machines/mc-xx9t7d6q\" " with result "range_response_count:1 size:2868" took too long (206.406312ms) to execute
2020-09-10 02:14:33.034105 W | etcdserver: read-only range request "key:\"/tke/notify/configmaps/tke-notify-controller\" " with result "range_response_count:1 size:539" took too long (219.982463ms) to execute
2020-09-10 02:14:33.034418 W | etcdserver: read-only range request "key:\"/tke/platform/machines/mc-zpnfttfh\" " with result "range_response_count:1 size:2869" took too long (307.724164ms) to execute
```

### 排查

查阅tke-platform-controller代码`tke/pkg/platform/controller/cluster/cluster_controller.go`

```
    // configure the namespace informer event handlers
    clusterInformer.Informer().AddEventHandlerWithResyncPeriod(
        cache.ResourceEventHandlerFuncs{
            AddFunc: controller.enqueueCluster,
            UpdateFunc: func(oldObj, newObj interface{}) {
                oldCluster, ok1 := oldObj.(*platformv1.Cluster)
                curCluster, ok2 := newObj.(*platformv1.Cluster)
                if ok1 && ok2 && controller.needsUpdate(oldCluster, curCluster) {
                    controller.enqueueCluster(newObj)
                } else {
                    log.Debug("Update new cluster not to add", log.String("clusterName", curCluster.Name), log.String("resourceversion", curCluster.ResourceVersion), log.String("old-resourceversion", oldCluster.ResourceVersion), log.String("cur-resourceversion", curCluster.ResourceVersion))
                }
            },
        },
        resyncPeriod,
    )
```

```
func (c *Controller) needsUpdate(old *platformv1.Cluster, new *platformv1.Cluster) bool {
    if !reflect.DeepEqual(old.Spec, new.Spec) {
        return true
    }

    if !reflect.DeepEqual(old.Status, new.Status) {
        return true
    }

    return false
}
```
基于cluster资源对象的clusterInformer，如果前后cluster对象的Spec和Status字段不变，则不把新对象放入工作队列


#### cluster controller核心处理逻辑
```
Run -> worker -> processNextWorkItem -> syncCluster ---> processClusterUpdate -> handlePhase -> ensureHealthCheck
                                                    |                                                 |
                                                    |                                                 |
                                                    |                                                 v
                                                    ---> processClusterDeletion                 watchClusterHealth
                                                                                                      |   
                                                                                                      |
                                                                                                      v
                                                                                                checkClusterHealth
```                                                     

#### HealthCheck代码逻辑
进行集群健康检查的话，最终会调用到ensureHealthCheck函数
```
func (c *Controller) ensureHealthCheck(key string, cluster *v1.Cluster) {
    if c.health.Exist(key) {
        return
    }

    log.Info("start health check for cluster", log.String("clusterName", key), log.String("phase", string(cluster.Status.Phase)))
    c.health.Set(cluster)
    go wait.PollImmediateUntil(5*time.Minute, c.watchClusterHealth(cluster.Name), c.stopCh)
}
```
有这样一段逻辑，如果c.health中的map存在key(集群的name,如：cls-bd46179d)就直接返回了，第一次执行的时候会加入到map中，什么时候会从c.health中移除？

在processClusterDelete函数中，c.health会移除对应的key; 而processClusterUpdate会从c.cache获取cachedCluster来对集群的UID是否一致，
不一致的话则触发processClusterDelete函数
```
func (c *Controller) processClusterUpdate(cachedCluster *cachedCluster, cluster *platformv1.Cluster, key string) error {
    if cachedCluster.state != nil {
        if cachedCluster.state.UID != cluster.UID {
            err := c.processClusterDelete(key)
            if err != nil {
                return err
            }
        }
    }

    // start update cluster if needed
    err := c.handlePhase(key, cachedCluster, cluster)
    if err != nil {
        return err
    }
    // 第一次执行的话，放入c.cache中
    cachedCluster.state = cluster
    // Always update the cache upon success.
    c.cache.set(key, cachedCluster)

    return nil
}

func (c *Controller) processClusterDelete(key string) error {
    log.Info("Cluster will be dropped", log.String("clusterName", key))

    if c.cache.Exist(key) {
        log.Info("Delete the cluster cache", log.String("clusterName", key))
        c.cache.delete(key)
    }

    if c.health.Exist(key) {
        log.Info("Delete the cluster health cache", log.String("clusterName", key))
        c.health.Del(key)
    }

    return nil
}
```
如果cachedCluster没失效的话，ensureHealthCheck就只会执行一次. watchClusterHealth会每隔5分钟执行一次

PollImmediateUntil会先执行condition函数，然后每隔interval执行一次condition
```            
func PollImmediateUntil(interval time.Duration, condition ConditionFunc, stopCh <-chan struct{}) error
```

PollUntil每隔interval执行一次condition
```
func PollUntil(interval time.Duration, condition ConditionFunc, stopCh <-chan struct{}) error                                           
```          

再来看看tke-platform-controller的日志
```
# kubectl -n tke logs tke-platform-controller-666d645579-g7z7v |grep "Check cluster health"
2020-09-10 06:37:53.740 info    Check cluster health    {"clusterName": "cls-4e67d80a"}
2020-09-10 06:37:53.740 info    Check cluster health    {"clusterName": "cls-bd46179d"}
2020-09-10 06:37:53.740 info    Check cluster health    {"clusterName": "global"}
2020-09-10 06:37:53.740 info    Check cluster health    {"clusterName": "cls-0b46be88"}
2020-09-10 06:42:54.455 info    Check cluster health    {"clusterName": "cls-0b46be88"}
2020-09-10 06:42:55.041 info    Check cluster health    {"clusterName": "cls-4e67d80a"}
2020-09-10 06:42:55.553 info    Check cluster health    {"clusterName": "global"}
2020-09-10 06:47:54.455 info    Check cluster health    {"clusterName": "cls-0b46be88"}
2020-09-10 06:47:55.040 info    Check cluster health    {"clusterName": "cls-4e67d80a"}
2020-09-10 06:47:55.553 info    Check cluster health    {"clusterName": "global"}
```
集群cls-bd46179d就没执行watchClusterHealth函数(Check cluster health日志是在函数第一行输出的)，再回头来看`go wait.PollImmediateUntil(5*time.Minute, c.watchClusterHealth(cluster.Name), c.stopCh)`,
是不是第一次执行condition(watchClusterHealth)的时候就return err导致退出5分钟定时器的循环？
```
// PollImmediateUntil tries a condition func until it returns true, an error or stopCh is closed.
//
// PollImmediateUntil runs the 'condition' before waiting for the interval.
// 'condition' will always be invoked at least once.
func PollImmediateUntil(interval time.Duration, condition ConditionFunc, stopCh <-chan struct{}) error {
    done, err := condition()
    if err != nil {
        return err
    }
    if done {
        return nil
    }
    select {
    case <-stopCh:
        return ErrWaitTimeout
    default:
        return PollUntil(interval, condition, stopCh)
    }
}
```
执行watchClusterHealth，如果不是找不到这个集群或者集群处于Terminating的状态，最终会调用到checkClusterHealth

```
// for PollImmediateUntil, when return true ,an err while exit
func (c *Controller) watchClusterHealth(clusterName string) func() (bool, error) {
    return func() (bool, error) {
        log.Info("Check cluster health", log.String("clusterName", clusterName))

        cluster, err := c.client.PlatformV1().Clusters().Get(clusterName, metav1.GetOptions{})
        if err != nil {
            if errors.IsNotFound(err) {
                log.Warn("Cluster not found, to exit the health check loop", log.String("clusterName", clusterName))
                return true, nil
            }
            log.Error("Check cluster health, cluster get failed", log.String("clusterName", clusterName), log.Err(err))
            return false, nil
        }

        if cluster.Status.Phase == v1.ClusterTerminating {
            log.Warn("Cluster status is Terminating, to exit the health check loop", log.String("clusterName", cluster.Name))
            return true, nil
        }

        _ = c.checkClusterHealth(cluster)
        return false, nil
    }
}
```

```
func (c *Controller) checkClusterHealth(cluster *v1.Cluster) error {
    // wait for create clustercredential, optimize first health check for user experience
    if cluster.Status.Phase == v1.ClusterInitializing {
        err := wait.PollImmediate(time.Second, time.Minute, func() (bool, error) {
            _, err := util.ClusterCredentialV1(c.client.PlatformV1(), cluster.Name)
            if err != nil {
                return false, nil
            }
            return true, nil
        })
        if err != nil { // not return! execute next steps to show reason for user
            log.Warn("wait for create clustercredential error", log.String("clusterName", cluster.Name))
        }
    }
    kubeClient, err := util.BuildExternalClientSet(cluster, c.client.PlatformV1())
    if err != nil {
        cluster.Status.Phase = v1.ClusterFailed
        cluster.Status.Message = err.Error()
        cluster.Status.Reason = reasonHealthCheckFail
        now := metav1.Now()
        c.addOrUpdateCondition(cluster, v1.ClusterCondition{
            Type:               conditionTypeHealthCheck,
            Status:             v1.ConditionFalse,
            Message:            err.Error(),
            Reason:             reasonHealthCheckFail,
            LastTransitionTime: now,
            LastProbeTime:      now,
        })
        if err1 := c.persistUpdate(cluster); err1 != nil {
            log.Warn("Update cluster status failed", log.String("clusterName", cluster.Name), log.Err(err1))
            return err1
        }
        log.Warn("Failed to build the cluster client", log.String("clusterName", cluster.Name), log.Err(err))
        return err
    }

    res, err := c.caclClusterResource(kubeClient)
    if err != nil {
        cluster.Status.Phase = v1.ClusterFailed
        cluster.Status.Message = err.Error()
        cluster.Status.Reason = reasonHealthCheckFail
        now := metav1.Now()
        c.addOrUpdateCondition(cluster, v1.ClusterCondition{
            Type:               conditionTypeHealthCheck,
            Status:             v1.ConditionFalse,
            Message:            err.Error(),
            Reason:             reasonHealthCheckFail,
            LastTransitionTime: now,
            LastProbeTime:      now,
        })
        if err1 := c.persistUpdate(cluster); err1 != nil {
            log.Warn("Update cluster status failed", log.String("clusterName", cluster.Name), log.Err(err1))
            return err1
        }
        log.Warn("Failed to build the cluster client", log.String("clusterName", cluster.Name), log.Err(err))
        return err
    }
    cluster.Status.Resource = *res

    _, err = kubeClient.CoreV1().Namespaces().List(metav1.ListOptions{})
    if err != nil {
        cluster.Status.Phase = v1.ClusterFailed
        cluster.Status.Message = err.Error()
        cluster.Status.Reason = reasonHealthCheckFail
        c.addOrUpdateCondition(cluster, v1.ClusterCondition{
            Type:          conditionTypeHealthCheck,
            Status:        v1.ConditionFalse,
            Message:       err.Error(),
            Reason:        reasonHealthCheckFail,
            LastProbeTime: metav1.Now(),
        })
    } else {
        cluster.Status.Phase = v1.ClusterRunning
        cluster.Status.Message = ""
        cluster.Status.Reason = ""
        c.addOrUpdateCondition(cluster, v1.ClusterCondition{
            Type:          conditionTypeHealthCheck,
            Status:        v1.ConditionTrue,
            Message:       "",
            Reason:        "",
            LastProbeTime: metav1.Now(),
        })

        // update version info
        if cluster.Status.Version == "" {
            log.Debug("Update version info", log.String("clusterName", cluster.Name))
            if version, err := kubeClient.ServerVersion(); err == nil {
                entireVersion, err := semver.ParseTolerant(version.GitVersion)
                if err != nil {
                    return err
                }
                pureVersion := semver.Version{Major: entireVersion.Major, Minor: entireVersion.Minor, Patch: entireVersion.Patch}
                log.Info("Set cluster version", log.String("clusterName", cluster.Name), log.String("version", pureVersion.String()), log.String("entireVersion", entireVersion.String()))
                cluster.Status.Version = pureVersion.String()
                now := metav1.Now()
                c.addOrUpdateCondition(cluster, v1.ClusterCondition{
                    Type:               conditionTypeSyncVersion,
                    Status:             v1.ConditionTrue,
                    Message:            "",
                    Reason:             "",
                    LastProbeTime:      now,
                    LastTransitionTime: now,
                })
            }
        }
    }

    if err := c.persistUpdate(cluster); err != nil {
        log.Error("Update cluster status failed", log.String("clusterName", cluster.Name), log.Err(err))
        return err
    }
    return err
}
```
checkClusterHealth执行逻辑：
1. 如果业务员集群状态为Initializing, 执行wait.PollImmediate(time.Second, time.Minute, func() (bool, error)获取集群Credential; 间隔1s，超时时间为1分钟，超时后就退出定时器; 会立即先执行一次func
2. 构建对应业务集群的clientSet
3. 计算业务集群资源使用情况，包含两种，一、nodes的capacity和allocatable，二、pod resource的Requests资源
4. 获取业务集群的所有namespace
5. 更新业务集群的Status

会在哪一步出错呢，是在计算业务集群资源使用情况这块，计算业务集群资源使用情况会调用`podsList, err := kubeClient.CoreV1().Pods("").List(metav1.ListOptions{Limit: int64(500)})`
```
# kubectl --kubeconfig=/etc/tke/tke-platform-config.yaml get cluster  cls-bd46179d -o yaml

  - lastProbeTime: "2020-09-09T11:40:27Z"
    lastTransitionTime: "2020-09-09T11:40:27Z"
    message: '1Get https://192.168.55.14:6443/api/v1/pods?limit=500: dial tcp 192.168.55.14:6443:
      connect: connection refused'
    reason: HealthCheckFail
    status: "False"
    type: HealthCheck
  - lastProbeTime: "2020-09-08T07:50:15Z"
    lastTransitionTime: "2020-09-08T07:50:15Z"
    status: "True"
    type: SyncVersion
  dnsIP: 172.20.252.10
  nodeCIDRMaskSize: 24
  phase: Failed
```                                    

### 其它情况

在进行集群健康检查的时候，如果集群的master机器的操作系统密码或密钥被更改的话；会导致update cluster资源对象失败，因为在对
cluster资源对象create/update的时候，platform-api那端会有validated的操作，校验cluster资源对象中的机器是否能ssh.

validated的操作具体是定义在哪里呢？platform-api也是k8s aggregator api，调用了`func (e *Store) Create/func (e *Store) Update`,该方法
也实现了k8s.io/apiserver中定义的Storage接口, 要暴露RESTful API就要实现Storage接口
```
//TODO:
// Storage interfaces need to be separated into two groups; those that operate
// on collections and those that operate on individually named items.
// Collection interfaces:
// (Method: Current -> Proposed)
//    GET: Lister -> CollectionGetter
//    WATCH: Watcher -> CollectionWatcher
//    CREATE: Creater -> CollectionCreater
//    DELETE: (n/a) -> CollectionDeleter
//    UPDATE: (n/a) -> CollectionUpdater
//
// Single item interfaces:
// (Method: Current -> Proposed)
//    GET: Getter -> NamedGetter
//    WATCH: (n/a) -> NamedWatcher
//    CREATE: (n/a) -> NamedCreater
//    DELETE: Deleter -> NamedDeleter
//    UPDATE: Update -> NamedUpdater

// Storage is a generic interface for RESTful storage services.
// Resources which are exported to the RESTful API of apiserver need to implement this interface. It is expected
// that objects may implement any of the below interfaces.
type Storage interface {
    // New returns an empty object that can be used with Create and Update after request data has been put into it.
    // This object must be a pointer type for use with Codec.DecodeInto([]byte, runtime.Object)
    New() runtime.Object
}

// Creater is an object that can create an instance of a RESTful object.
type Creater interface {
    // New returns an empty object that can be used with Create after request data has been put into it.
    // This object must be a pointer type for use with Codec.DecodeInto([]byte, runtime.Object)
    New() runtime.Object

    // Create creates a new version of a resource.
    Create(ctx context.Context, obj runtime.Object, createValidation ValidateObjectFunc, options *metav1.CreateOptions) (runtime.Object, error)
}

// Updater is an object that can update an instance of a RESTful object.
type Updater interface {
    // New returns an empty object that can be used with Update after request data has been put into it.
    // This object must be a pointer type for use with Codec.DecodeInto([]byte, runtime.Object)
    New() runtime.Object

    // Update finds a resource in the storage and updates it. Some implementations
    // may allow updates creates the object - they should set the created boolean
    // to true.
    Update(ctx context.Context, name string, objInfo UpdatedObjectInfo, createValidation ValidateObjectFunc, updateValidation ValidateObjectUpdateFunc, forceAllowCreate bool, options *metav1.UpdateOptions) (runtime.Object, bool, error)
}
```

#### create cluster Validate执行逻辑
```
func (e *Store) Create(ctx context.Context, obj runtime.Object, createValidation rest.ValidateObjectFunc, options *metav1.CreateOptions) (runtime.Object, error)
                        |
                        |
                        v
       rest.BeforeCreate(e.CreateStrategy, ctx, obj)
                        |
                        |
                        v
         strategy.Validate(ctx, obj)

# 以platform cluster api为例，还有business api, notify api， platform machine api等等

// Validate validates a new cluster
func (s *Strategy) Validate(ctx context.Context, obj runtime.Object) field.ErrorList {
    return ValidateCluster(s.clusterProviders, obj.(*platform.Cluster), s.platformClient, true)
} 
```

ValidateCluster函数
```
// ValidateCluster tests if required fields in the cluster are set.
func ValidateCluster(clusterProviders *sync.Map, obj *platform.Cluster, platformClient platforminternalclient.PlatformInterface, create bool) field.ErrorList {
    allErrs := apiMachineryValidation.ValidateObjectMeta(&obj.ObjectMeta, false, ValidateClusterName, field.NewPath("metadata"))
    if create {
        //这里有ValidateLicenseLimit检验License的逻辑在这里
        allErrs = append(allErrs, validation.ValidateLicenseLimit(platformClient)...)
    }

    if obj.Spec.Properties.MaxNodePodNum != nil {
        if !util.InInt32Slice(nodePodNumAvails, *obj.Spec.Properties.MaxNodePodNum) {
            allErrs = append(allErrs, field.Invalid(field.NewPath("spec", "properties", "maxNodePodNum"), *obj.Spec.Properties.MaxNodePodNum, fmt.Sprintf("must in values of `%#v`", nodePodNumAvails)))
        }
    }

    if obj.Spec.Properties.MaxClusterServiceNum != nil {
        if !util.InInt32Slice(clusterServiceNumAvails, *obj.Spec.Properties.MaxClusterServiceNum) {
            allErrs = append(allErrs, field.Invalid(field.NewPath("spec", "properties", "maxClusterServiceNum"), *obj.Spec.Properties.MaxClusterServiceNum, fmt.Sprintf("must in values of `%#v`", clusterServiceNumAvails)))
        }
    }

    if obj.Spec.Type == "" {
        allErrs = append(allErrs, field.Required(field.NewPath("spec", "type"), fmt.Sprintf("availble type are %v", types)))
    } else {
        if !funk.Contains(types, obj.Spec.Type) {
            allErrs = append(allErrs, field.Invalid(field.NewPath("spec", "type"), obj.Spec.Type, fmt.Sprintf("availble type are %v", types)))
        } else {
            if obj.Spec.Type == platform.ClusterImported {
                if len(obj.Status.Addresses) == 0 {
                    allErrs = append(allErrs, field.Required(field.NewPath("status", "addresses"), "must specify at least one obj access address"))
                } else {
                    for _, address := range obj.Status.Addresses {
                        if address.Host == "" {
                            allErrs = append(allErrs, field.Required(field.NewPath("status", "addresses", string(address.Type), "host"), "must specify the ip of address"))
                        }
                        if address.Port == 0 {
                            allErrs = append(allErrs, field.Required(field.NewPath("status", "addresses", string(address.Type), "port"), "must specify the port of address"))
                        }
                        _, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", address.Host, address.Port), 5*time.Second)
                        if err != nil {
                            allErrs = append(allErrs, field.Invalid(field.NewPath("status", "addresses"), address, err.Error()))
                        }
                    }
                }
            } else {
                clusterProvider, err := provider.LoadClusterProvider(clusterProviders, string(obj.Spec.Type))
                if err != nil {
                    allErrs = append(allErrs, field.InternalError(field.NewPath("spec"), err))
                }

                resp, err := clusterProvider.Validate(*obj)
                if err != nil {
                    allErrs = append(allErrs, field.InternalError(field.NewPath("spec"), err))
                }
                allErrs = append(allErrs, resp...)
            }
        }
    }
    return allErrs
}
```

`ValidateLicenseLimit`校验License这里到底做了什么呢？
```
// ValidateLicenseLimit validate user license limit
func ValidateLicenseLimit(platformClient platforminternalclient.PlatformInterface) field.ErrorList {
    var allErrs field.ErrorList

    if !filter.RunInPod || platformClient == nil { //没有运行在pod中，一般是自测环境，不校验License
        return allErrs
    }
    //获取所有集群
    clusters, err := platformClient.Clusters().List(metav1.ListOptions{})
    if err != nil {
        allErrs = append(allErrs, field.InternalError(field.NewPath("spec", "name"), syserr.New("List clusters fail where check license ")))
    } else {
        clusterNum := len(clusters.Items)
        sysClusterNum := 0
        if filter.RunInPod { //global 集群的pod中。global 集群是系统创建的，不计入用户集群数目
            sysClusterNum = 1
        }
        clusterNum = clusterNum - sysClusterNum
        //校验集群数量是不是超过License里定义的最大数量
        if clusterNum >= filter.LicenseInfo.Cluster.MaxNum {
            allErrs = append(allErrs, field.Forbidden(field.NewPath("spec", "name"), fmt.Sprintf("the cluster num upper limit(%d) has been reached", filter.LicenseInfo.Cluster.MaxNum)))
        }
        totalNodeNum := 0
        totalCPUNum := 0
        //遍历集群，global集群除外
        for _, cluster := range clusters.Items {
            credential, err := util.ClusterCredential(platformClient, cluster.Name)
            if err != nil {
                continue
            }
            client, err := util.BuildClientSet(&cluster, credential)
            if err != nil {
                log.Warn("connect user cluster fail when check license limit " + err.Error())
                continue
            }
            // calcClusterResource函数是遍历集群中的所有节点，累加计算节点cpu capacity
            nodeNum, cpuNum, err := calcClusterResource(client)
            if err != nil {
                log.Warn("calc cluster resource fail when check license limit " + err.Error())
                continue
            }
            if cluster.Name != "global" { //global 集群的pod中。global 集群是系统创建的，不计入用户集群
                //累加计算所有集群的节点数和cpu总数
                totalNodeNum = totalNodeNum + nodeNum
                totalCPUNum = totalCPUNum + cpuNum
            }
        }
        //License校验是否超出最大节点总数
        if totalNodeNum >= filter.LicenseInfo.Cluster.MaxNodeNum {
            allErrs = append(allErrs, field.Forbidden(field.NewPath("spec", "name"), fmt.Sprintf("the node num upper limit(%d) has been reached", filter.LicenseInfo.Cluster.MaxNodeNum)))
        }
        //License校验是否超出最大cpu总数
        if totalCPUNum >= filter.LicenseInfo.Cluster.MaxCPUNum {
            allErrs = append(allErrs, field.Forbidden(field.NewPath("spec", "name"), fmt.Sprintf("the cpu num upper limit(%d) has been reached", filter.LicenseInfo.Cluster.MaxCPUNum)))
        }
        log.Infof("ValidateLicenseLimit current cluster num %d, max cluster num %d, current node num %d, max node num %d, current cpu num %d, max cpu num %d",
            clusterNum, filter.LicenseInfo.Cluster.MaxNum, totalNodeNum, filter.LicenseInfo.Cluster.MaxNodeNum, totalCPUNum, filter.LicenseInfo.Cluster.MaxCPUNum)
    }

    return allErrs
}
```
`ValidateLicenseLimit`做了这些工作：
1. 获取所有集群列表，后续计算时把global集群除外
2. 校验集群数量
3. 遍历集群（global除外），再遍历集群的节点，累加所有集群所有计算节点的总cpu capacity以及所有集群总节点数
4. 校验节点总数
5. 校验cpu总数

最终调用baremental-cluster-provider中的Validate
```
clusterProvider, err := provider.LoadClusterProvider(clusterProviders, string(obj.Spec.Type))
if err != nil {
    allErrs = append(allErrs, field.InternalError(field.NewPath("spec"), err))
}

resp, err := clusterProvider.Validate(*obj)
```

```
func (p *Provider) Validate(c platform.Cluster) (field.ErrorList, error) {
    var allErrs field.ErrorList

    sPath := field.NewPath("spec")

    if !funk.ContainsString(versions, c.Spec.Version) {
        allErrs = append(allErrs, field.Invalid(sPath.Child("version"), c.Spec.Version, fmt.Sprintf("valid versions are %q", versions)))
    }

    if c.Spec.ClusterCIDR == "" {
        allErrs = append(allErrs, field.Required(sPath.Child("clusterCIDR"), ""))
    } else {
        _, _, err := net.ParseCIDR(c.Spec.ClusterCIDR)
        if err != nil {
            allErrs = append(allErrs, field.Invalid(sPath.Child("clusterCIDR"), c.Spec.ClusterCIDR, fmt.Sprintf("parse CIDR error:%s", err)))
        }
    }

    // kubeadm need the 10th ip!
    if *c.Spec.Properties.MaxClusterServiceNum < 10 {
        allErrs = append(allErrs, field.Invalid(sPath.Child("Properties.MaxClusterServiceNum"), *c.Spec.Properties.MaxClusterServiceNum, "must not less than 10"))
    }

    // validate machines
    if c.Spec.Machines == nil {
        allErrs = append(allErrs, field.Required(sPath.Child("machines"), ""))
    } else {
        var ips []string
        for i, machine := range c.Spec.Machines {
            idxPath := sPath.Child("machine").Index(i)
            if machine.IP == "" {
                allErrs = append(allErrs, field.Required(idxPath, ""))
            } else {
                if funk.Contains(ips, machine.IP) {
                    allErrs = append(allErrs, field.Duplicate(idxPath, machine.IP))
                } else {
                    ips = append(ips, machine.IP)

                    if machine.Password == nil && machine.PrivateKey == nil {
                        allErrs = append(allErrs, field.Required(idxPath.Child("password"), "password or privateKey at least one"))
                    }
                    sshConfig := &ssh.Config{
                        User:        machine.Username,
                        Host:        machine.IP,
                        Port:        int(machine.Port),
                        Password:    string(machine.Password),
                        PrivateKey:  machine.PrivateKey,
                        PassPhrase:  machine.PassPhrase,
                        DialTimeOut: time.Second,
                        Retry:       0,
                    }
                    s, err := ssh.New(sshConfig)
                    if err != nil {
                        allErrs = append(allErrs, field.Forbidden(idxPath, err.Error()))
                    } else {
                        err = s.Ping()
                        if err != nil {
                            allErrs = append(allErrs, field.Forbidden(idxPath, err.Error()))
                        }
                    }
                }
            }
        }
    }

    return allErrs, nil
}
```
遍历c.Spec.Machines，并逐个进行ping测试

#### update cluster Validate执行逻辑
```
func (e *Store) Update(ctx context.Context, name string, objInfo rest.UpdatedObjectInfo, createValidation rest.ValidateObjectFunc, updateValidation rest.ValidateObjectUpdateFunc, forceAllowCreate bool, options *metav1.UpdateOptions) (runtime.Object, bool, error)
                        |
                        |
                        v
       rest.BeforeUpdate(e.UpdateStrategy, ctx, obj, existing)
                        |
                        |
                        v
         strategy.ValidateUpdate(ctx, obj, old)

# 以platform cluster api为例，还有business api, notify api， platform machine api等等

// ValidateUpdate is the default update validation for an end cluster.
func (s *Strategy) ValidateUpdate(ctx context.Context, obj, old runtime.Object) field.ErrorList {
    return ValidateClusterUpdate(s.clusterProviders, obj.(*platform.Cluster), old.(*platform.Cluster), s.platformClient)
}

// ValidateClusterUpdate tests if required fields in the cluster are set during
// an update.
func ValidateClusterUpdate(clusterProviders *sync.Map, cluster *platform.Cluster, old *platform.Cluster, platformClient platforminternalclient.PlatformInterface) field.ErrorList {
    allErrs := apiMachineryValidation.ValidateObjectMetaUpdate(&cluster.ObjectMeta, &old.ObjectMeta, field.NewPath("metadata"))
    // 调用了ValidateCluster
    allErrs = append(allErrs, ValidateCluster(clusterProviders, cluster, platformClient, false)...)

    if cluster.Spec.Type != "" {
        if cluster.Spec.Type != platform.ClusterImported {
            clusterProvider, err := provider.LoadClusterProvider(clusterProviders, string(cluster.Spec.Type))
            if err != nil {
                allErrs = append(allErrs, field.InternalError(field.NewPath("spec"), err))
            }

            resp, err := clusterProvider.ValidateUpdate(*cluster, *old)
            if err != nil {
                allErrs = append(allErrs, field.InternalError(field.NewPath("spec", "annotations"), err))
            }
            allErrs = append(allErrs, resp...)
        }
    }

    return allErrs
}     
```

最终调用baremental-cluster-provider中的Validate和ValidateUpdate
```
// ValidateUpdate只是返回了错误，并没有其它操作
func (p *Provider) ValidateUpdate(cluster platform.Cluster, oldCluster platform.Cluster) (field.ErrorList, error) {
    var allErrs field.ErrorList
    return allErrs, nil
}
```

上面看了Cluster api的validate操作，create/update cluster对象的时候最终都会进行ssh ping检查操作，如果ssh ping检查失败的话也会引起cluster
对象健康检查失败.

#### create machine Validate执行逻辑

create machine Validate走的也是这个流程
```
func (e *Store) Create(ctx context.Context, obj runtime.Object, createValidation rest.ValidateObjectFunc, options *metav1.CreateOptions) (runtime.Object, error)
                        |
                        |
                        v
       rest.BeforeCreate(e.CreateStrategy, ctx, obj)
                        |
                        |
                        v
         strategy.Validate(ctx, obj)
```

最终走到machine的Validate函数，machine的Validate做了哪些校验的工作呢？
```
// Validate tests if required fields in the machine are set.
func Validate(machineProviders *sync.Map, obj *platform.Machine, platformClient platforminternalclient.PlatformInterface) field.ErrorList {
    var err error
    allErrs := apiMachineryvalidation.ValidateObjectMeta(&obj.ObjectMeta, false, apiMachineryvalidation.NameIsDNSLabel, field.NewPath("metadata"))

    //跟创建集群一样有ValidateLicenseLimit校验
    allErrs = append(allErrs, validation.ValidateLicenseLimit(platformClient)...)
    // validate Type
    if obj.Spec.Type == "" {
        allErrs = append(allErrs, field.Required(field.NewPath("spec", "type"), "must specify machine type"))
    } else {
        if !funk.Contains(types, obj.Spec.Type) {
            allErrs = append(allErrs, field.Invalid(field.NewPath("spec", "type"), obj.Spec.Type, fmt.Sprintf("availble type are %v", types)))
        }
        p, err := provider.LoadMachineProvider(machineProviders, string(obj.Spec.Type))
        if err != nil {
            allErrs = append(allErrs, field.InternalError(field.NewPath("spec"), err))
        } else {
            //这里调用了machine provider的Validate
            resp, err := p.Validate(*obj)
            if err != nil {
                allErrs = append(allErrs, field.InternalError(field.NewPath("spec"), err))
            }
            allErrs = append(allErrs, resp...)
        }
    }

    // validate ClusterName
    var machineList *platform.MachineList
    var cluster *platform.Cluster
    //校验集群是否存在
    clusterErrs := validation.ValidateCluster(platformClient, obj.Spec.ClusterName)
    if clusterErrs != nil {
        allErrs = append(allErrs, clusterErrs...)
    } else {
        cluster, err = platformClient.Clusters().Get(obj.Spec.ClusterName, metav1.GetOptions{})
        if err != nil {
            allErrs = append(allErrs, field.InternalError(field.NewPath("spec", "clusterName"),
                fmt.Errorf("can't get cluster:%s", err)))
        } else {
            //计算最大节点数
            _, cidr, _ := net.ParseCIDR(cluster.Spec.ClusterCIDR)
            ones, _ := cidr.Mask.Size()
            maxNode := math.Exp2(float64(cluster.Status.NodeCIDRMaskSize - int32(ones)))

            fieldSelector := fmt.Sprintf("spec.clusterName=%s", obj.Spec.ClusterName)
            //获取machine列表
            machineList, err = platformClient.Machines().List(metav1.ListOptions{FieldSelector: fieldSelector})
            if err != nil {
                allErrs = append(allErrs, field.InternalError(field.NewPath("spec", "clusterName"),
                    fmt.Errorf("list machines of the cluster error:%s", err)))
            } else {
                //对比machine总数和最大节点数
                machineSize := len(machineList.Items)
                if machineSize >= int(maxNode) {
                    allErrs = append(allErrs, field.Forbidden(field.NewPath("spec"),
                        fmt.Sprintf("the cluster's machine upper limit(%d) has been reached", int(maxNode))))
                }
            }
        }
    }

    // validate IP
    if obj.Spec.IP == "" {
        allErrs = append(allErrs, field.Required(field.NewPath("spec", "IP"), "must specify IP"))
    } else {
        if machineList != nil {
            for _, machine := range machineList.Items {
                if machine.Spec.IP == obj.Spec.IP {
                    allErrs = append(allErrs, field.Duplicate(field.NewPath("spec", "IP"), obj.Spec.IP))
                }
            }
        }
        if cluster != nil {
            for _, machine := range cluster.Spec.Machines {
                if machine.IP == obj.Spec.IP {
                    allErrs = append(allErrs, field.Duplicate(field.NewPath("spec", "IP"), obj.Spec.IP))
                }
            }
        }
    }
    if obj.Spec.Port == 0 {
        allErrs = append(allErrs, field.Required(field.NewPath("spec", "IP"), "must specify Port"))
    }

    // validate ssh
    if obj.Spec.Password == nil && obj.Spec.PrivateKey == nil {
        allErrs = append(allErrs, field.Required(field.NewPath("spec", "password"), "password or privateKey at least one"))
    }
    //ssh登录校验
    sshConfig := &ssh.Config{
        User:        obj.Spec.Username,
        Host:        obj.Spec.IP,
        Port:        int(obj.Spec.Port),
        Password:    string(obj.Spec.Password),
        PrivateKey:  obj.Spec.PrivateKey,
        PassPhrase:  obj.Spec.PassPhrase,
        DialTimeOut: time.Second,
        Retry:       0,
    }
    s, err := ssh.New(sshConfig)
    if err != nil {
        allErrs = append(allErrs, field.Forbidden(field.NewPath("spec"), err.Error()))
    } else {
        err = s.Ping()
        if err != nil {
            allErrs = append(allErrs, field.Forbidden(field.NewPath("spec"), err.Error()))
        }
    }

    return allErrs
}
```
                                   
### 参考链接

- [https://github.com/tkestack/tke](https://github.com/tkestack/tke)