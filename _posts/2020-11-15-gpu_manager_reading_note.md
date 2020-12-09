---
layout: post
title: TKEStack
subtitle: gpu-manager源码阅读笔记
catalog: true
hide: true
tags:
     - tkestack
---

### 环境

- 系统：CentOS 7
- kernel: 3.10.0-862.el7.x86_64
- Kubernetes: v1.19.3

### gpu-manager简介

>GPU Manager用于管理Kubernetes集群中的nvidia GPU设备。它实现了Kubernetes的DevicePlugin接口。因此它与1.9+的Kubernetes发行版兼容.
>为了与`nvidia-docker`和`nvidia-k8s-plugin`的组合解决方案进行比较，GPU管理器将使用未经修改的原生runc，
>而nvidia解决方案则进行了修改。此外，我们还支持指标报告，而无需部署新组件。为了正确地调度GPU负载，GPU管理器应该使用[gpu-admission](https://github.com/tkestack/gpu-admission)（这是kubernetes调度程序插件）.
>GPU管理器还支持带有GPU设备分数资源的有效负载，例如0.1卡或100MiB gpu设备内存。如果您想要这种功能，请参考[vcuda-controller](https://github.com/tkestack/vcuda-controller)项目。

### 安装nvidia显卡驱动

配置cuda源
```shell script
wget https://developer.nvidia.com/compute/cuda/10.0/Prod/local_installers/cuda-repo-rhel7-10-0-local-10.0.130-410.48-1.0-1.x86_64
mv cuda-repo-rhel7-10-0-local-10.0.130-410.48-1.0-1.x86_64 cuda-repo-rhel7-10-0-local-10.0.130-410.48-1.0-1.x86_64.rpm
rpm -Uvh cuda-repo-rhel7-10-0-local-10.0.130-410.48-1.0-1.x86_64.rpm
yum install cuda
```

验证nvidia包是否装上
```shell script
# rpm -qa|grep -i nvidia
nvidia-libXNVCtrl-410.48-1.el7.x86_64
nvidia-libXNVCtrl-devel-410.48-1.el7.x86_64
nvidia-driver-410.48-1.el7.x86_64
nvidia-persistenced-410.48-1.el7.x86_64
nvidia-driver-cuda-libs-410.48-1.el7.x86_64
nvidia-xconfig-410.48-1.el7.x86_64
nvidia-modprobe-410.48-1.el7.x86_64
nvidia-settings-410.48-1.el7.x86_64
nvidia-driver-NvFBCOpenGL-410.48-1.el7.x86_64
nvidia-driver-NVML-410.48-1.el7.x86_64
nvidia-driver-devel-410.48-1.el7.x86_64
dkms-nvidia-410.48-1.el7.x86_64
nvidia-driver-cuda-410.48-1.el7.x86_64
nvidia-driver-libs-410.48-1.el7.x86_64
```

重启系统，使用命令查看GPU显卡信息
```shell script
# nvidia-container-cli -k info
NVRM version:   410.48
CUDA version:   10.0

Device Index:   0
Device Minor:   0
Model:          Tesla P40
Brand:          Tesla
GPU UUID:       GPU-750f713a-e058-8803-7ed5-4810b457ed96
Bus Location:   00000000:04:00.0
Architecture:   6.1
...

```

### gpu-manager部署

```shell script
git clone https://github.com/tkestack/gpu-manager.git
```
最新的tag是v1.1.0，dockerhub上没有对应编译好的image

编译镜像
```shell script
make img
```

```shell script
# 给有显卡的node节点打label
kubectl label <node-x> 9.19.177.194 nvidia-device-enable=enable
```

gpu-manager部署yaml
```shell script
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gpu-manager
  namespace: kube-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: gpu-manager
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
- kind: ServiceAccount
  name: gpu-manager
  namespace: kube-system
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: gpu-manager-daemonset
  namespace: kube-system
spec:
  updateStrategy:
    type: RollingUpdate
  selector:
    matchLabels:
      name: gpu-manager-ds
  template:
    metadata:
      # This annotation is deprecated. Kept here for backward compatibility
      # See https://kubernetes.io/docs/tasks/administer-cluster/guaranteed-scheduling-critical-addon-pods/
      annotations:
        scheduler.alpha.kubernetes.io/critical-pod: ""
      labels:
        name: gpu-manager-ds
    spec:
      serviceAccount: gpu-manager
      tolerations:
        # This toleration is deprecated. Kept here for backward compatibility
        # See https://kubernetes.io/docs/tasks/administer-cluster/guaranteed-scheduling-critical-addon-pods/
        - key: CriticalAddonsOnly
          operator: Exists
        - key: tencent.com/vcuda-core
          operator: Exists
          effect: NoSchedule
      # Mark this pod as a critical add-on; when enabled, the critical add-on
      # scheduler reserves resources for critical add-on pods so that they can
      # be rescheduled after a failure.
      # See https://kubernetes.io/docs/tasks/administer-cluster/guaranteed-scheduling-critical-addon-pods/
      priorityClassName: "system-node-critical"
      # only run node hash gpu device
      nodeSelector:
        nvidia-device-enable: enable
      hostPID: true
      containers:
        - image: tkestack/gpu-manager:1.1.0
          imagePullPolicy: IfNotPresent
          name: gpu-manager
          securityContext:
            privileged: true
          ports:
            - containerPort: 5678
          volumeMounts:
            - name: device-plugin
              mountPath: /var/lib/kubelet/device-plugins
            - name: vdriver
              mountPath: /etc/gpu-manager/vdriver
            - name: vmdata
              mountPath: /etc/gpu-manager/vm
            - name: log
              mountPath: /var/log/gpu-manager
            - name: run-dir
              mountPath: /var/run
            - name: cgroup
              mountPath: /sys/fs/cgroup
              readOnly: true
            - name: usr-directory
              mountPath: /usr/local/host
              readOnly: true
          env:
            - name: LOG_LEVEL
              value: "5"
            - name: EXTRA_FLAGS
              value: "--logtostderr=true"
            - name: NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
      volumes:
        - name: device-plugin
          hostPath:
            type: Directory
            path: /var/lib/kubelet/device-plugins
        - name: vmdata
          hostPath:
            type: DirectoryOrCreate
            path: /etc/gpu-manager/vm
        - name: vdriver
          hostPath:
            type: DirectoryOrCreate
            path: /etc/gpu-manager/vdriver
        - name: log
          hostPath:
            type: DirectoryOrCreate
            path: /etc/gpu-manager/log
        # We have to mount the whole /var/run directory into container, because of bind mount docker.sock
        # inode change after host docker is restarted
        - name: run-dir
          hostPath:
            type: Directory
            path: /var/run
        - name: cgroup
          hostPath:
            type: Directory
            path: /sys/fs/cgroup
        # We have to mount /usr directory instead of specified library path, because of non-existing
        # problem for different distro
        - name: usr-directory
          hostPath:
            type: Directory
            path: /usr
---
apiVersion: v1
kind: Service
metadata:
  name: gpu-manager-metric
  namespace: kube-system
  annotations:
    prometheus.io/scrape: "true"
  labels:
    kubernetes.io/cluster-service: "true"
spec:
  clusterIP: None
  ports:
    - name: metrics
      port: 5678
      protocol: TCP
      targetPort: 5678
  selector:
    name: gpu-manager-ds
```

### gpu-admission部署

创建gpu-quota-admission配置文件
```shell script
echo '
{
	"QuotaConfigMapName": "gpuquota",
	"QuotaConfigMapNamespace": "kube-system",
	"GPUModelLabel": "gaia.tencent.com/gpu-model",
	"GPUPoolLabel": "gaia.tencent.com/gpu-pool"
}' > /etc/kubernetes/gpu-quota-admission.config
```

static pod方式部署gpu-quota-admission
```shell script
mkdir -p /etc/kubernetes/kube-scheduler/
cp /root/.kube/config /etc/kubernetes/kube-scheduler/kubeconfig

echo '
apiVersion: v1
kind: Pod
metadata:
  annotations:
    scheduler.alpha.kubernetes.io/critical-pod: ""
  name: gpu-admission
  namespace: kube-system
spec:
  containers:
  - image: tkestack/gpu-quota-admission:v1.0.0 
    imagePullPolicy: IfNotPresent 
    name: gpu-admission
    env:
    - name: LOG_LEVEL
      value: "4"
    - name: EXTRA_FLAGS
      value: "--incluster-mode=false"
    ports:
    - containerPort: 3456
    volumeMounts:
    - mountPath: /etc/kubernetes/
      name: kubernetes
      readOnly: true
    - mountPath: /var/log/gpu-admission
      name: log
  dnsPolicy: ClusterFirstWithHostNet
  hostNetwork: true
  priority: 2000000000
  priorityClassName: system-cluster-critical
  volumes:
  - hostPath:
      type: Directory
      path: /etc/kubernetes/
    name: kubernetes
  - hostPath:
      type: DirectoryOrCreate
      path: /var/log/gpu-admission
    name: log
' > /etc/kubernetes/manifests/gpu-admission.yaml
```

配置kube-scheduler调度策略
```shell script
echo '
{
    "kind": "Policy",
    "apiVersion": "v1",
    "predicates": [
        {
            "name": "PodFitsHostPorts"
        },
        {
            "name": "PodFitsResources"
        },
        {
            "name": "NoDiskConflict"
        },
        {
            "name": "MatchNodeSelector"
        },
        {
            "name": "HostName"
        }
    ],
    "priorities": [
        {
            "name": "BalancedResourceAllocation",
            "weight": 1
        },
        {
            "name": "ServiceSpreadingPriority",
            "weight": 1
        }
    ],
    "extenders": [
        {
            "urlPrefix": "http://127.0.0.1:3456/scheduler",
            "apiVersion": "v1beta1",
            "filterVerb": "predicates",
            "enableHttps": false,
            "nodeCacheCapable": false
        }
    ],
    "hardPodAffinitySymmetricWeight": 10,
    "alwaysCheckAllPredicates": false
}' > /etc/kubernetes/scheduler-policy-config.json
```

让上述调度策略文件生效，重启kube-scheduler服务
```shell script
vim /etc/kubernetes/manifests/kube-scheduler.yaml
    - --policy-config-file=/etc/kubernetes/scheduler-policy-config.json
    - --use-legacy-policy-config=true
```

### 验证测试

#### 查看节点显卡资源
```shell script
kubectl  describe nodes node53
......
tencent.com/vcuda-core:    700(7张GPU卡)
 tencent.com/vcuda-memory:  668(总共256M*668M显存)
```
可以看到可分配的显卡资源

#### 整卡分配

```shell script
[root@node53 ~]# cat test.yaml 
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vcuda-test
spec:
  selector:
    matchLabels:
      app: vcuda-test
  template:
    metadata:
      labels:
        app: vcuda-test
    spec:
      containers:
      - name: vcuda-test
        image: nvidia/cuda:10.1-base-centos7
        command: ['/usr/local/nvidia/bin/nvidia-smi', '-l', '1']
        resources:
          requests:
            tencent.com/vcuda-core: 100
            tencent.com/vcuda-memory: 30
          limits:
            tencent.com/vcuda-core: 100
            tencent.com/vcuda-memory: 30
```

### 非整卡分配




### gpu-manager代码分析

#### 接口

Manager接口
```
//Manager api
type Manager interface {
	Ready() bool
	Run() error
	RegisterToKubelet() error
}
```

ResourceServer接口
```
//ResourceServer api for manager
type ResourceServer interface {
	Run() error
	Stop()
	SocketName() string
	ResourceName() string
}
```

GPUTopoService接口
```
//GPUTopoService is server api for GPU topology service
type GPUTopoService interface {
	pluginapi.DevicePluginServer
	ListAndWatchWithResourceName(string, *pluginapi.Empty, pluginapi.DevicePlugin_ListAndWatchServer) error
}
```

GPUTree接口
```
//GPUTree is an interface for GPU tree structure
type GPUTree interface {
	Init(input string)
	Update()
}
```

#### 结构体

Options结构体
```
// Options contains plugin information
type Options struct {
    //GPU manager驱动，默认值为nvidia
	Driver                   string
    //额外配置文件加载路径
	ExtraPath                string
    //volume配置文件路径，volume.conf记录了具体路径关于使用到的cuda命令和nvidia cuda库
	VolumeConfigPath         string
    //让prometheus查询metric监听的端口
	QueryPort                int
    //让prometheus查询metric监听的地址
	QueryAddr                string
    //kubeConfig路径，获取集群资源信息的凭证 
	KubeConfigFile           string
    //每张GPU卡执行的时间段，默认单位秒
	SamplePeriod             int
    //节点自动打标签
	NodeLabels               string
    //节点主机名标识，非实际主机名
	HostnameOverride         string
    //virtual manager配置文件路径，默认值为/etc/gpu-manager/vm
	VirtualManagerPath       string
    //device plugin注册插件的路径
	DevicePluginPath         string
    //是否启用GPU共享分配
	EnableShare              bool
    //检查已分配GPU的间隔，单位秒 
	AllocationCheckPeriod    int
    //checkpoint配置存储的路径，默认值为/etc/gpu-manager
	CheckpointPath           string
    //容器运行时，默认值为/var/run/dockershim.sock
	ContainerRuntimeEndpoint string
    //cgroup驱动，默认cgroupfs，还有systemd
	CgroupDriver             string
    //请求容器运行时的超时时间
	RequestTimeout           time.Duration
}
```

Config结构体, 定义的变量跟Options结构体类似
```
// Config contains the necessary options for the plugin.
type Config struct {
	Driver                   string
	ExtraConfigPath          string
	QueryPort                int
	QueryAddr                string
	KubeConfig               string
	SamplePeriod             time.Duration
	Hostname                 string
	NodeLabels               map[string]string
	VirtualManagerPath       string
	DevicePluginPath         string
	VolumeConfigPath         string
	EnableShare              bool
	AllocationCheckPeriod    time.Duration
	CheckpointPath           string
	ContainerRuntimeEndpoint string
	CgroupDriver             string
	RequestTimeout           time.Duration
    // 存放cuda请求的channel
	VCudaRequestsQueue chan *types.VCudaRequest
}
```

managerImpl结构体，实现了Manager接口
```
type managerImpl struct {
	config *config.Config
    //提供GPU拓扑服务的API
	allocator      allocFactory.GPUTopoService
    //显示GPU资源使用情况
	displayer      *display.Display
    //管理GPU资源
	virtualManager *vitrual_manager.VirtualManager
    //管理vcore和vmemory资源
	bundleServer map[string]ResourceServer
    //grpc server，接收gprc请求
	srv          *grpc.Server
}
```

Display结构体
```
//Display is used to show GPU device usage
type Display struct {
	sync.Mutex

	config                  *config.Config
    //nvidia GPU资源树
	tree                    *nvtree.NvidiaTree
    //容器运行时manager
	containerRuntimeManager runtime.ContainerRuntimeInterface
}
```

VolumeManager结构体
```
//VolumeManager manages volumes used by containers running GPU application
type VolumeManager struct {
	Config  []Config `json:"volume,omitempty"`
	cfgPath string

	cudaControlFile string
	cudaSoname      map[string]string
	mlSoName        map[string]string
	share           bool
}
```

containerRuntimeManager结构体, 实现了ContainerRuntimeInterface接口
```
type containerRuntimeManager struct {
	cgroupDriver   string
	runtimeName    string
	requestTimeout time.Duration
	client         criapi.RuntimeServiceClient
}
```

nodeLabeler结构体
```
type nodeLabeler struct {
	hostName    string
	client      v1core.CoreV1Interface
	labelMapper map[string]labelFunc
}
```

NvidiaTree结构体
```
//NvidiaTree represents a Nvidia GPU in a tree.
type NvidiaTree struct {
	sync.Mutex

	root   *NvidiaNode
	leaves []*NvidiaNode

	realMode     bool
	query        map[string]*NvidiaNode
	index        int
	samplePeriod time.Duration
}
```

#### 启动函数
```
# tkestack.io/gpu-manager/cmd/manager/nvidia-manager.go
func main() {
	klog.InitFlags(nil)
	opt := options.NewOptions()
	opt.AddFlags(pflag.CommandLine)

	flags.InitFlags()
	goflag.CommandLine.Parse([]string{})
	logs.InitLogs()
	defer logs.FlushLogs()

	version.PrintAndExitIfRequested()

	if err := app.Run(opt); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
}
```

app.Run主要执行逻辑：
1. 解析Options对象(配置参数)，来填充Config对象
2. 初始化managerImpl对象(实现了Manager接口)，执行接口中定义的Run函数
    - 校验config.ExtraConfigPath
    - 判断config.Driver是否为空
    - 如果配置了config.VolumeConfigPath，就初始化VolumeManager对象，执行VolumeManager.Run函数(解析volume.conf,创建对应的目录/硬链接,拷贝对应的文件)
    - systemd发送`READY=1`notify信息给daemon
    - 初始化ContainerRuntimeManager对象, 和容器运行时交互
    - 初始化clientSet, 使用sharedInformer创建pod cache(当前主机的所有pod)
    - 初始化nodeLabeler对象, 快速更新节点label
    - 初始化VirtualManager对象，执行VirtualManager的Run函数
        - 判断VirtualManagerPath是否为空，创建VirtualManagerPath目录
        - 执行vDeviceWatcher，遍历使用vgpu的running pod, 在`/etc/gpu-manager/vm/`每个pod目录对应一个vDevice的grpc server，并放入`DeviceServers map数据结构`
        每隔1min循环检测pod目录，如果不存在即停止grpc server，从`DeviceServers map数据结构`删除对应key
        - 执行garbageCollector，进行pod垃圾目录回收; 遍历`/etc/gpu-manager/vm/`目录下的pod目录，从所有使用vgpu的running pod中查找，不存在即删除对应的pod目录
        - 执行process，遍历VCudaRequestsQueue channel，获取对应事件记录的podUID，再次执行这个过程：
        在`/etc/gpu-manager/vm/`每个pod目录对应一个vDevice的grpc server，并放入`DeviceServers map数据结构`
3. 从deviceFactory设备工厂函数中根据config.Driver类型返回一个有名函数`NewFunc func(cfg *config.Config) GPUTree`，用于获取实现了`GPUTree`接口的具体实例对象；
    - 实现了GPUTree接口的有两类结构体：NvidiaTree和DummyTree，这两类结构体在其init函数实现了设备主册，顾名思义起作用的只有NvidiaTree.
    - 执行了`GPUTree`接口的Init和Update函数(gpu拓扑结构感知)
      Init函数：
      ```
      //Init a NvidiaTree.
      //Will try to use nvml first, fallback to input string if
      //parseFromLibrary() failed.
      func (t *NvidiaTree) Init(input string) {
      	err := t.parseFromLibrary()
      	if err == nil {
      		t.realMode = true
      		return
      	}
      
      	klog.V(2).Infof("Can't use nvidia library, err %s. Use text parser", err)
        //此处不会调用到，即使调用到也立即返回错误
      	err = t.parseFromString(input)
      
      	if err != nil {
      		klog.Fatalf("Can not initialize nvidia tree, err %s", err)
      	}
      }
      ```
      
      //封装了github.com/tkestack/go-nvml库，简化调用nvml的操作
      ```
      func (t *NvidiaTree) parseFromLibrary() error {
        //Initialize NVML, but don't initialize any GPUs yet
      	if err := nvml.Init(); err != nil {
      		return err
      	}
        //Shut down NVML by releasing all GPU resources previously allocated with nvmlInit_v2()
      	defer nvml.Shutdown()
        //Retrieves the version of the system's graphics driver.
      	driverVersion, err := nvml.SystemGetDriverVersion()
      	if err != nil {
      		return err
      	}
        //Retrieves the number of compute devices in the system. A compute device is a single GPU.
      	num, err := nvml.DeviceGetCount()
      	if err != nil {
      		return err
      	}
      
      	klog.V(2).Infof("Detect %d gpu cards", num)
      
      	nodes := make(LevelMap)
      	t.leaves = make([]*NvidiaNode, num)
      
      	for i := 0; i < int(num); i++ {
            //Acquire the handle for a particular device, based on its index.
      		dev, _ := nvml.DeviceGetHandleByIndex(uint(i))
            //Retrieves the amount of used, free and total memory available on the device, in bytes.
      		_, _, totalMem, _ := dev.DeviceGetMemoryInfo()
            //Retrieves the PCI attributes of this device.
      		pciInfo, _ := dev.DeviceGetPciInfo()
            //Retrieves minor number for the device. 
            //The minor number for the device is such that the Nvidia device node file for each GPU will have the form /dev/nvidia[minor number].
      		minorID, _ := dev.DeviceGetMinorNumber()
            //Retrieves the NVML index of this device.
      		uuid, _ := dev.DeviceGetUUID()
            //初始化新NvidiaNode对象
      		n := t.allocateNode(i)
      		n.AllocatableMeta.Cores = HundredCore
      		n.AllocatableMeta.Memory = int64(totalMem)
      		n.Meta.TotalMemory = totalMem
      		n.Meta.BusId = pciInfo.BusID
      		n.Meta.MinorID = int(minorID)
      		n.Meta.UUID = uuid
            //填充query map数据结构和leaves slice数组
      		t.addNode(n)
      	}
      
      	for cardA := uint(0); cardA < num; cardA++ {
            //Acquire the handle for a particular device, based on its index.
      		devA, _ := nvml.DeviceGetHandleByIndex(cardA)
      		for cardB := cardA + 1; cardB < num; cardB++ {
      			devB, _ := nvml.DeviceGetHandleByIndex(cardB)
                //Retrieve the common ancestor for two devices For all products. Supported on Linux only.
      			ntype, err := nvml.DeviceGetTopologyCommonAncestor(devA, devB)
      			if err != nil {
      				return err
      			}
      
      			switch driverVersion {
      			case "396.26":
      				if ntype == nvml.TOPOLOGY_INTERNAL {
      					ntype = nvml.TOPOLOGY_SINGLE
      				}
      			default:
      			}
      			if newNode := t.join(nodes, ntype, int(cardA), int(cardB)); newNode != nil {
      				klog.V(2).Infof("New node, type %d, mask %b", int(ntype), newNode.Mask)
      				nodes[ntype] = append(nodes[ntype], newNode)
      			}
      		}
      	}
      
      	for t, ns := range nodes {
      		klog.V(2).Infof("type: %d, len %d", int(t), len(ns))
      	}
      
      	t.buildTree(nodes)
      
      	return nil
      }
      ```
      
      Update函数
      ```
      //Update NvidiaTree by info getting from GPU devices.
      //Return immediately if real GPU device is not available.
      func (t *NvidiaTree) Update() {
         if !t.realMode {
            return
         }
          //Initialize NVML, but don't initialize any GPUs yet
          if err := nvml.Init(); err != nil {
              return
          }
      
          defer nvml.Shutdown()
      
          klog.V(4).Infof("Update device information")
      
          t.Lock()
          defer t.Unlock()
      
          for i := range t.Leaves() {
              node := t.updateNode(i)
      
              if node.pendingReset && node.AllocatableMeta.Cores == HundredCore {
                  resetGPUFeature(node, t.realMode)
      
                  if !node.pendingReset {
                      t.freeNode(node)
                  }
              }
      
              klog.V(4).Infof("node %d, pid: %+v, memory: %+v, utilization: %+v, pendingReset: %+v",
                  i, node.Meta.Pids, node.Meta.UsedMemory, node.Meta.Utilization, node.pendingReset)
      
              node = node.Parent
              for node != nil {
                  node.Meta.Pids = make([]uint, 0)
                  node.Meta.UsedMemory = 0
                  node.Meta.TotalMemory = 0
      
                  for _, child := range node.Children {
                      node.Meta.Pids = append(node.Meta.Pids, child.Meta.Pids...)
                      node.Meta.UsedMemory += child.Meta.UsedMemory
                      node.Meta.TotalMemory += child.Meta.TotalMemory
                  }
      
                  node = node.Parent
              }
          }
      }
      ```
      更新树节点显存使用情况，还有pid列表
   
GPU拓扑结构矩阵图
```
# nvidia-smi topo -m
	    GPU0	GPU1	GPU2	GPU3	GPU4	GPU5	GPU6	mlx4_0	CPU Affinity	NUMA Affinity
GPU0	 X 	    PIX	    PIX	    PHB	    PHB	    PHB	    PHB	    PIX	    0-13,28-41	    0
GPU1	PIX	    X 	    PIX	    PHB	    PHB	    PHB	    PHB	    PIX	    0-13,28-41	    0
GPU2	PIX	    PIX	    X 	    PHB	    PHB	    PHB	    PHB	    PIX	    0-13,28-41	    0
GPU3	PHB	    PHB	    PHB	    X 	    PIX	    PIX	    PIX	    PHB	    0-13,28-41	    0 
GPU4	PHB	    PHB	    PHB	    PIX	    X 	    PIX	    PIX	    PHB	    0-13,28-41	    0
GPU5	PHB	    PHB	    PHB	    PIX	    PIX	    X 	    PIX	    PHB	    0-13,28-41	    0
GPU6	PHB	    PHB	    PHB	    PIX	    PIX	    PIX	    X 	    PHB	    0-13,28-41	    0
mlx4_0	PIX	    PIX	    PIX	    PHB	    PHB	    PHB	    PHB	 X 		

Legend:

  X    = Self
  SYS  = Connection traversing PCIe as well as the SMP interconnect between NUMA nodes (e.g., QPI/UPI)
  NODE = Connection traversing PCIe as well as the interconnect between PCIe Host Bridges within a NUMA node
  PHB  = Connection traversing PCIe as well as a PCIe Host Bridge (typically the CPU)
  PXB  = Connection traversing multiple PCIe bridges (without traversing the PCIe Host Bridge)
  PIX  = Connection traversing at most a single PCIe bridge
  NV#  = Connection traversing a bonded set of # NVLinks 
```

理想状态下构建出来的树状结构是:
```
ROOT:7:0
|--PHB:7:0
|  |--PIX:3:0
|  |  |--GPU0:1:1
|  |  |--GPU1:1:1
|  |  |--GPU2:1:1
|  |--PIX:4:0
|  |  |--GPU3:1:2
|  |  |--GPU4:1:2
|  |  |--GPU5:1:2
|  |  |--GPU6:1:2
```

资源-访问代价树
>拓扑节点中存储3个信息：
• 子节点的GPU通信方式(SOC、PXB、PHB或
PIX)
• 可用的GPU资源数(如果下属n张GPU卡则为n)
• 节点通信开销(非GPU节点为0)
GPU节点存储3个信息：
• GPU id
• 可用的GPU资源数(GPU节点为1)
• 节点通信开销(数字越小，访问代价越低)

六类通信方式分类中，通信开销：
NV# < PIX < PXB < PHB < NODE < SYS

根据代码得出的树状图跟理论模型有差异
```
ROOT:7:0
|--PHB:7:0
|  |--PHB:3:0
|  |  |--GPU0:1:1
|  |  |--GPU1:1:1
|  |  |--GPU2:1:1
|  |--PIX:4:0
|  |  |--GPU3:1:2
|  |  |--GPU4:1:2
|  |  |--GPU5:1:2
|  |  |--GPU6:1:2
```

4. 从allocFactory工厂函数中根据config.Driver类型返回一个有名函数`NewFunc func(cfg *config.Config, tree device.GPUTree, k8sClient kubernetes.Interface) GPUTopoService`， 
   用于获取实现了`GPUTopoService`接口的具体实例对象；这里config.Driver是nvidia,所以返回的是NvidiaTopoAllocator对象
   ```
   //Register stores NewFunc in factory
   func Register(name string, item NewFunc) {
       if _, ok := factory[name]; ok {
           return
       }
   
       klog.V(2).Infof("Register NewFunc with name %s", name)
   
       factory[name] = item
   }
   
   //NewFuncForName tries to find NewFunc by name, return nil if not found
   func NewFuncForName(name string) NewFunc {
       if item, ok := factory[name]; ok {
           return item
       }
   
       klog.V(2).Infof("Can not find NewFunc with name %s", name)
   
       return nil
   }
   ```
   NvidiaTopoAllocator调用Register函数实现插件注册
      
   ```
   func init() {
       allocator.Register("nvidia", NewNvidiaTopoAllocator)
       allocator.Register("nvidia_test", NewNvidiaTopoAllocatorForTest)
   }
   
   //NewNvidiaTopoAllocator returns a new NvidiaTopoAllocator
   func NewNvidiaTopoAllocator(config *config.Config, tree device.GPUTree, k8sClient kubernetes.Interface) allocator.GPUTopoService {
       _tree, _ := tree.(*nvtree.NvidiaTree)
       cm, err := checkpoint.NewManager(config.CheckpointPath, checkpointFileName)
       if err != nil {
           klog.Fatalf("Failed to create checkpoint manager due to %s", err.Error())
       }
       alloc := &NvidiaTopoAllocator{
           tree:              _tree,
           config:            config,
           evaluators:        make(map[string]Evaluator),
           allocatedPod:      cache.NewAllocateCache(),
           k8sClient:         k8sClient,
           queue:             workqueue.NewRateLimitingQueue(workqueue.DefaultControllerRateLimiter()),
           stopChan:          make(chan struct{}),
           checkpointManager: cm,
       }
   
       // Load kernel module if it's not loaded
       //加载nvidia-uvm nvidia内核模块
       alloc.loadModule()
   
       // Initialize evaluator
       //映射到三种不同模式(link、fragment、share)的树结构
       alloc.initEvaluator(_tree)
   
       // Read extra config if it's given
       alloc.loadExtraConfig(config.ExtraConfigPath)
   
       // Process allocation results in another goroutine
       //标准controller的process函数，不断从队列中获取key，根据结果给pod patch上annotation
       go wait.Until(alloc.runProcessResult, time.Second, alloc.stopChan)
   
       // Recover
       //故障恢复的处理函数
       alloc.recoverInUsed()
   
       // Check allocation in another goroutine periodically
       //定时器检测gpu pod的卡分配，类似垃圾回收器
       go alloc.checkAllocationPeriodically(alloc.stopChan)
   
       return alloc
   }
   ```  
5. 初始化返回一个Display对象，记录GPU卡的使用情况
6. 启动vcore和vmemory grpc server，两种device plugin插件的具体实现
7. 建立/pprof的api调用
8. 建立/metric的api调用，暴露metric值; 监听在http地址和端口
9. 监听unix socket，启动服务

### gpu-admission代码分析



### 参考链接

- [CentOS7.5的GPU 1080 Ti 顯示卡安裝cuda](https://www.itread01.com/content/1543303098.html)
- [腾讯企业容器云平台技术解析](https://zhuanlan.zhihu.com/p/53421721)
