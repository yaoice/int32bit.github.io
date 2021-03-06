---
layout: post
title: TKEStack
subtitle: galaxy源码阅读笔记
catalog: true
tags:
     - tkestack
---

### 简介

Galaxy是一个Kubernetes网络项目，旨在为Pod提供overlay和高性能底层网络。并且它还实现了浮动IP（或弹性IP），
即Pod的IP即使由于节点崩溃而飘到另一个节点上也不会改变，这对于运行有状态集合应用程序非常有利。

### galaxy组件

它由三个组件组成-Galaxy，CNI插件和Galaxy IPAM。

- Galaxy：在每个kubelet节点上运行的守护进程，该进程调用不同种类的CNI插件来设置Pod所需的网络。
- Galaxy IPAM：是Kubernetes Scheduler插件(Scheduler Extender方式扩展)，可以用作浮动IP配置和IP分配管理器。
- CNI插件

galaxy更像是后端可以接多种cni插件的适配器

### 安装配置

克隆galaxy项目
```
# git clone https://github.com/tkestack/galaxy.git
git checkout v1.0.4
```

#### galaxy cni配置
```
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: cni-etc
  namespace: kube-system
data:
  00-galaxy.conf: |
    {
      "type": "galaxy-sdn",
      "capabilities": {"portMappings": true},
      "cniVersion": "0.2.0"
    }
```
galaxy的cni配置文件，调用的是galaxy-sdn的二进制文件，实际上它通过unix socket连接到galaxy server；透传了cni请求的参数

#### galaxy server配置
```
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: galaxy-etc
  namespace: kube-system
data:
  galaxy.json: |
    {
      "NetworkConf":[
        {"name":"tke-route-eni","type":"tke-route-eni","eni":"eth1","routeTable":1},
        {"name":"galaxy-flannel","type":"galaxy-flannel", "delegate":{"type":"galaxy-veth"},"subnetFile":"/run/flannel/subnet.env"},
        {"name":"galaxy-k8s-vlan","type":"galaxy-k8s-vlan", "device":"{{ .DeviceName }}", "default_bridge_name": "br0"},
        {"name":"galaxy-k8s-sriov","type": "galaxy-k8s-sriov", "device": "{{ .DeviceName }}", "vf_num": 10}
      ],
      "DefaultNetworks": ["galaxy-flannel"]
    }
```
galaxy的配置文件，默认使用的cni插件是flannel(重命名为galaxy-flannel而已)；galaxy-flannel cni配置的delegate参数为galaxy-veth插件

#### galaxy daemonset
```
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  labels:
    app: galaxy
  name: galaxy-daemonset
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: galaxy
  template:
    metadata:
      labels:
        app: galaxy
    spec:
      serviceAccountName: galaxy
      hostNetwork: true
      hostPID: true
      containers:
      - image: tkestack/galaxy:v1.0.6
        command: ["/bin/sh"]
      # qcloud galaxy should run with --route-eni
        args: ["-c", "cp -p /etc/galaxy/cni/00-galaxy.conf /etc/cni/net.d/; cp -p /opt/cni/galaxy/bin/galaxy-sdn /opt/cni/galaxy/bin/loopback /opt/cni/bin/; /usr/bin/galaxy --logtostderr=true --v=3 --network-policy"]
      # private-cloud should run without --route-eni
      # args: ["-c", "cp -p /etc/galaxy/cni/00-galaxy.conf /etc/cni/net.d/; cp -p /opt/cni/galaxy/bin/galaxy-sdn /opt/cni/galaxy/bin/loopback /opt/cni/bin/; /usr/bin/galaxy --logtostderr=true --v=3"]
        imagePullPolicy: IfNotPresent
        env:
          - name: MY_NODE_NAME
            valueFrom:
              fieldRef:
                fieldPath: spec.nodeName
          - name: DOCKER_HOST
            value: unix:///host/run/docker.sock
        name: galaxy
        resources:
          requests:
            cpu: 100m
            memory: 200Mi
        securityContext:
          privileged: true
        volumeMounts:
        - name: galaxy-run
          mountPath: /var/run/galaxy/
        - name: flannel-run
          mountPath: /run/flannel
        - name: galaxy-log
          mountPath: /data/galaxy/logs
        - name: galaxy-etc
          mountPath: /etc/galaxy
        - name: cni-config
          mountPath: /etc/cni/net.d/
        - name: cni-bin
          mountPath: /opt/cni/bin
        - name: cni-etc
          mountPath: /etc/galaxy/cni
        - name: cni-state
          mountPath: /var/lib/cni
        - name: docker-sock
          mountPath: /host/run/
      terminationGracePeriodSeconds: 30
      tolerations:
      - effect: NoSchedule
        operator: Exists
      volumes:
      - name: galaxy-run
        hostPath:
          path: /var/run/galaxy
      - name: flannel-run
        hostPath:
          path: /run/flannel
      - name: galaxy-log
        emptyDir: {}
      - configMap:
          defaultMode: 420
          name: galaxy-etc
        name: galaxy-etc
      - name: cni-config
        hostPath:
          path: /etc/cni/net.d/
      - name: cni-bin
        hostPath:
          path: /opt/cni/bin
      - name: cni-state
        hostPath:
          path: /var/lib/cni
      - configMap:
          defaultMode: 420
          name: cni-etc
        name: cni-etc
      - name: docker-sock
        # in case of docker restart, /run/docker.sock may change, we have to mount the /run directory
        hostPath:
          path: /run/
```

#### flannel yaml配置
```
# kubectl apply -f flannel-v0.10.0.yaml
---
apiVersion: v1
data:
  cni-conf.json: |
    {
      "name": "cbr0",
      "plugins": [
        {
          "type": "flannel",
          "delegate": {
            "hairpinMode": true,
            "isDefaultGateway": true
          }
        },
        {
          "type": "portmap",
          "capabilities": {
            "portMappings": true
          }
        }
      ]
    }
  net-conf.json: |
    {
      "Network": "172.28.0.0/16",
      "Backend": {
        "Type": "vxlan"
      }
    }
kind: ConfigMap
metadata:
  labels:
    app: flannel
    tier: node
  name: kube-flannel-cfg
  namespace: kube-system
---
apiVersion: extensions/v1beta1
kind: DaemonSet
metadata:
  labels:
    k8s-app: flannel
  name: flannel
  namespace: kube-system
spec:
  selector:
    matchLabels:
      k8s-app: flannel
  template:
    metadata:
      labels:
        k8s-app: flannel
    spec:
      containers:
      - args:
        - --ip-masq
        - --kube-subnet-mgr
        command:
        - /opt/bin/flanneld
        env:
        - name: POD_NAME
          valueFrom:
            fieldRef:
              apiVersion: v1
              fieldPath: metadata.name
        - name: POD_NAMESPACE
          valueFrom:
            fieldRef:
              apiVersion: v1
              fieldPath: metadata.namespace
        image: quay.io/coreos/flannel:v0.10.0-amd64
        imagePullPolicy: IfNotPresent
        name: kube-flannel
        resources:
          limits:
            cpu: 100m
            memory: 256Mi
          requests:
            cpu: 100m
            memory: 50Mi
        securityContext:
          privileged: true
        terminationMessagePath: /dev/termination-log
        terminationMessagePolicy: File
        volumeMounts:
        - mountPath: /run
          name: run
        - mountPath: /etc/kube-flannel/
          name: flannel-cfg
      dnsPolicy: ClusterFirst
      hostNetwork: true
      nodeSelector:
        beta.kubernetes.io/arch: amd64
      restartPolicy: Always
      schedulerName: default-scheduler
      securityContext: {}
      serviceAccount: flannel
      serviceAccountName: flannel
      terminationGracePeriodSeconds: 30
      tolerations:
      - effect: NoSchedule
        operator: Exists
      volumes:
      - hostPath:
          path: /run
          type: ""
        name: run
      - hostPath:
          path: /etc/cni/net.d
          type: ""
        name: cni
      - configMap:
          defaultMode: 420
          name: kube-flannel-cfg
        name: flannel-cfg
  templateGeneration: 1
  updateStrategy:
    rollingUpdate:
      maxUnavailable: 1
    type: RollingUpdate
```
还是需要安装flannel daemonset，flannel建立节点间的vxlan隧道或host-gw静态路由

### 源码分析

#### 代码结构
```
tkestack.io iceyao$ tree -L 3 galaxy/
galaxy/
├── CONTRIBUTING.md
├── LICENSE
├── Makefile    galaxy的Makefile文件
├── README.md
├── Vagrantfile
├── artifacts   floatingip和pool的crd yaml文件
│   └── examples
│       ├── crd.yaml
│       ├── example-floatip.yaml
│       └── example-pool.yaml
├── build
│   ├── docker
│   │   ├── galaxy       galaxy Dockerfile
│   │   └── galaxy-ipam  galaxy-ipam Dockerfile
│   └── lib              Makefile引用的库
│       ├── build.sh     编译辅助脚本
│       ├── common.mk    Makefile公共变量
│       ├── create-manifest.sh  创建docker manifest文件，用于构建多cpu架构镜像
│       ├── golang.mk    golang编译相关
│       ├── image.mk     docker镜像编译相关
│       └── install-buildx.sh  安装buildx的脚本
├── cmd
│   ├── galaxy           galaxy启动程序入口
│   │   └── galaxy.go
│   └── galaxy-ipam      galaxy-ipam启动程序入口
│       └── galaxy-ipam.go
├── cni                  具体cni插件实现
│   ├── ipam
│   │   └── ipam.go
│   ├── k8s-sriov
│   │   ├── k8s_sriov.go
│   │   └── sriov.conf
│   ├── k8s-vlan
│   │   ├── k8s_vlan.go
│   │   └── myvlan.conf
│   ├── sdn
│   │   ├── sdn.conf
│   │   └── sdn.go
│   ├── tke-route-eni
│   │   ├── cni.go
│   │   ├── driver.go
│   │   └── tke-route-eni.conf
│   ├── underlay
│   │   └── veth
│   └── veth
│       └── veth.go
├── doc    文档
│   ├── building.md
│   ├── contributing.md
│   ├── float-ip.md
│   ├── galaxy-config.md
│   ├── galaxy-ipam-config.md
│   ├── getting-started.md
│   ├── image
│   │   ├── galaxy-ipam-scheduling-process.png
│   │   ├── galaxy-ipam.png
│   │   ├── galaxy.png
│   │   ├── policy-egress-rule.png
│   │   ├── policy-ingress-rule.png
│   │   └── policy-ipset.png
│   ├── network-policy.md
│   ├── supported-cnis.md
│   └── swagger.json
├── e2e             e2e测试用例
│   ├── README.md
│   ├── cni-request
│   │   ├── cni_request_suite_test.go
│   │   └── request_test.go
│   ├── e2e.go
│   ├── helper
│   │   ├── cni.go
│   │   ├── topology.go
│   │   ├── util.go
│   │   └── util_test.go
│   ├── k8s-vlan
│   │   ├── bridge_test.go
│   │   ├── k8s_vlan_suite_test.go
│   │   └── vlan_test.go
│   ├── underlay
│   │   └── veth
│   └── veth
│       ├── veth_suite_test.go
│       └── veth_test.go
├── go.mod
├── go.sum
├── hack                   辅助工具脚本
│   ├── build-native.sh
│   ├── build-tools.sh
│   ├── generate_proto.sh
│   ├── test.sh
│   ├── update-codegen.sh
│   ├── updatevendor.sh
│   └── verify-codegen.sh
├── pkg
│   ├── api
│   │   ├── cniutil   cni工具库，构建/解析CNIArgs，Delegate cmdAdd/cmdDel请求
│   │   ├── docker    docker client对象，与docker交互
│   │   ├── galaxy    galaxy自定义cni请求结构体，自定义pod请求结构体
│   │   └── k8s       hostPort映射关系
│   ├── galaxy        galaxy对象，命令行参数，galaxy server启动, 透传cni请求
│   │   ├── galaxy.go
│   │   ├── options
│   │   └── server.go
│   ├── gc
│   │   ├── flannel_gc.go      flannel垃圾回收器
│   │   ├── flannel_gc_test.go
│   │   └── gc.go
│   ├── ipam
│   │   ├── api
│   │   ├── apis
│   │   ├── client
│   │   ├── cloudprovider
│   │   ├── crd              floatingip/pool Crd定义
│   │   ├── floatingip
│   │   ├── schedulerplugin  调度插件类型定义
│   │   ├── server          Server结构体，命令行启动参数
│   │   └── utils
│   ├── network
│   │   ├── kernel          内核相关参数
│   │   ├── netlink.go
│   │   ├── netlink_test.go
│   │   ├── netns
│   │   ├── portmapping     端口映射，包含iptables规则处理，端口监听操作
│   │   └── vlan
│   ├── policy              networkPolicy实现，同步ipset/iptables规则
│   │   ├── event.go
│   │   ├── policy.go
│   │   └── policy_test.go
│   ├── signal
│   │   └── signal.go
│   ├── tke
│   │   └── eni             弹性网卡模式(公有云场景)
│   └── utils               封装的工具操作库
│       ├── httputil
│       ├── ips
│       ├── ipset
│       ├── iptables         封装了iptables的操作工具库，来自k8s
│       ├── ldflags
│       ├── netlink.go
│       ├── netlink_test.go
│       ├── nets
│       ├── page
│       ├── utils.go
│       └── utils_test.go
├── tools
│   ├── netlink_monitor
│   │   └── monitor.go
│   ├── network
│   │   └── setupvlan.go
│   └── route_monitor
│       ├── Dockerfile
│       ├── daemonset.yaml
│       └── route_monitor.go
├── vagrant.sh
└── yaml                    k8s部署yaml
    ├── galaxy-ipam.yaml
    ├── galaxy.yaml
    └── scheduler-policy.yaml

70 directories, 88 files
```

#### galaxy server
```
cmd/galaxy/galaxy.go

func main() {
    // initialize rand seed
    rand.Seed(time.Now().UTC().UnixNano())
    // 初始化galaxy对象
    galaxy := galaxy.NewGalaxy()
    // add command line args
    // 接收命令行参数
    galaxy.AddFlags(pflag.CommandLine)
    flag.InitFlags()
    //日志初始化，默认每隔5秒钟flush下pending的log I/O
    logs.InitLogs()
    defer logs.FlushLogs()

    // if checking version, print it and exit
    ldflags.PrintAndExitIfRequested()
    if err := galaxy.Start(); err != nil {
        glog.Fatalf("Error start galaxy: %v", err)
    }
    // handle signals
    signal.BlockSignalHandler(func() {
        if err := galaxy.Stop(); err != nil {
            glog.Errorf("Error stop galaxy: %v", err)
        }
    })
}
```
1. 设置随机数种子
2. 初始化galaxy对象
3. 初始化galaxy命令行参数
4. 是否打印版本信息
5. 启动galaxy程序
6. 监听退出信号，终止galaxy程序

Galaxy结构体
```
type Galaxy struct {
    JsonConf
    *options.ServerRunOptions
    quitChan  chan struct{}
    dockerCli *docker.DockerInterface
    netConf   map[string]map[string]interface{}
    pmhandler *portmapping.PortMappingHandler
    client    kubernetes.Interface
    pm        *policy.PolicyManager
}

type JsonConf struct {
    NetworkConf     []map[string]interface{} // all detailed network configurations
    DefaultNetworks []string                 // pod's default networks if it doesn't have networks annotation
    // If not empty, set pod's default network to `ENIIPNetwork` regardless of `DefaultNetworks` if pod wants eni ip
    // and has no networks annotation
    ENIIPNetwork string
}
```

进入Start函数
```
func (g *Galaxy) Start() error {
    // 加载galaxy.json配置，初始化dockerCli、netConf、pmhandler变量
    if err := g.Init(); err != nil {
        return err
    }
    // 初始化client变量，并设置k8s clientSet的QPS为1000.0, Burst为2000
    g.initk8sClient()
    // 启动Flannel垃圾回收器
    // 1. 回收IP, 在/var/lib/cni/networks/目录下
    // 2. 回收gc目录下的文件
    //    /var/lib/cni/galaxy/$containerid：记录使用的network type，类似galaxy-flannel或galaxy-sriov等
    //    /var/lib/cni/flannel/$containerid：记录使用的flannel cni plugin chain，类似{"ipMasq":false,"ipam":{"routes":[{"dst":"172.28.0.0/16"}],"subnet":"172.28.0.0/24","type":"host-local"},"mtu":1450,"name":"","type":"galaxy-veth"}
    //    /var/lib/cni/galaxy/port/$containerid：记录hostPort与pod containerPort的映射关系
    // 3. 回收veth设备
    gc.NewFlannelGC(g.dockerCli, g.quitChan, g.cleanIPtables).Run()
    // 是否开启bridge-nf-call-iptables参数
    kernel.BridgeNFCallIptables(g.quitChan, g.BridgeNFCallIptables)
    // 是否开启ip_forward
    kernel.IPForward(g.quitChan, g.IPForward)
    // 监听hostPort宿主机端口，设置hostPort iptables
    if err := g.setupIPtables(); err != nil {
        return err
    }
    // 根据NetworkPolicy，同步ipset/iptables规则
    if g.NetworkPolicy {
        g.pm = policy.New(g.client, g.quitChan)
        go wait.Until(g.pm.Run, 3*time.Minute, g.quitChan)
    }
    // 弹性网卡模式
    if g.RouteENI {
        // TODO do all sysctl things via a config
        // 禁用rp_filter参数
        kernel.DisableRPFilter(g.quitChan)
        eni.SetupENIs(g.quitChan)
    }
    // 启动galaxy server，监听在unix套接字上
    return g.StartServer()
}
```

进入StartServer()
```
// StartServer will start galaxy server.
func (g *Galaxy) StartServer() error {
    // 是否开启pprof
    if g.PProf {
        go func() {
            http.ListenAndServe("127.0.0.1:0", nil)
        }()
    }
    // 设置路由
    g.installHandlers()
    if err := os.MkdirAll(private.GalaxySocketDir, 0755); err != nil {
        return fmt.Errorf("failed to create %s: %v", private.GalaxySocketDir, err)
    }
    if err := os.Remove(private.GalaxySocketPath); err != nil {
        if !os.IsNotExist(err) {
            return fmt.Errorf("failed to remove %s: %v", private.GalaxySocketPath, err)
        }
    }
    l, err := net.Listen("unix", private.GalaxySocketPath)
    if err != nil {
        return fmt.Errorf("failed to listen on pod info socket: %v", err)
    }
    if err := os.Chmod(private.GalaxySocketPath, 0600); err != nil {
        _ = l.Close()
        return fmt.Errorf("failed to set pod info socket mode: %v", err)
    }

    glog.Fatal(http.Serve(l, nil))
    return nil
}
```

g.installHandlers()设置路由
```
// 使用github.com/emicklei/go-restful web框架
func (g *Galaxy) installHandlers() {
    ws := new(restful.WebService)
    // GET/POST /cni的路径
    ws.Route(ws.GET("/cni").To(g.cni))
    ws.Route(ws.POST("/cni").To(g.cni))
    restful.Add(ws)
}

func (g *Galaxy) cni(r *restful.Request, w *restful.Response) {
    // 获取请求的body内容
    data, err := ioutil.ReadAll(r.Request.Body)
    if err != nil {
        glog.Warningf("bad request %v", err)
        http.Error(w, fmt.Sprintf("err read body %v", err), http.StatusBadRequest)
        return
    }
    defer r.Request.Body.Close() // nolint: errcheck
    // 把cni请求转化为pod请求
    req, err := galaxyapi.CniRequestToPodRequest(data)
    if err != nil {
        glog.Warningf("bad request %v", err)
        http.Error(w, fmt.Sprintf("%v", err), http.StatusBadRequest)
        return
    }
    // 字符串右边做去除冒号处理
    req.Path = strings.TrimRight(fmt.Sprintf("%s:%s", req.Path, strings.Join(g.CNIPaths, ":")), ":")
    // 调用requestFunc
    result, err := g.requestFunc(req)
    if err != nil {
        http.Error(w, fmt.Sprintf("%v", err), http.StatusInternalServerError)
    } else {
        // Empty response JSON means success with no body
        w.Header().Set("Content-Type", "application/json")
        if _, err := w.Write(result); err != nil {
            glog.Warningf("Error writing %s HTTP response: %v", req.Command, err)
        }
    }
}
```

CNIRequest、PodRequest结构体
```
// Request sent to the Galaxy by the Galaxy SDN CNI plugin
type CNIRequest struct {
    // CNI environment variables, like CNI_COMMAND and CNI_NETNS
    Env map[string]string `json:"env,omitempty"`
    // CNI configuration passed via stdin to the CNI plugin
    Config []byte `json:"config,omitempty"`
}

// Request structure built from CNIRequest which is passed to the
// handler function given to the CNIServer at creation time
type PodRequest struct {
    // The CNI command of the operation
    Command string
    // kubernetes namespace name
    PodNamespace string
    // kubernetes pod name
    PodName string
    // kubernetes pod ports
    Ports []k8s.Port
    // Channel for returning the operation result to the CNIServer
    Result chan *PodResult
    // Args
    *skel.CmdArgs
    // specific CNI plugin args, key: cni type, inner key: args name, value: args value
    ExtendedCNIArgs map[string]map[string]json.RawMessage
}

// Result of a PodRequest sent through the PodRequest's Result channel.
type PodResult struct {
    // Response to be returned to the OpenShift SDN CNI plugin on success
    Response []byte
    // Error to be returned to the OpenShift SDN CNI plugin on failure
    Err error
}
```

galaxyapi.CniRequestToPodRequest(data)，把cni请求转化为pod请求
```
func CniRequestToPodRequest(data []byte) (*PodRequest, error) {
    var cr CNIRequest
    // 解析CNIRequest
    if err := json.Unmarshal(data, &cr); err != nil {
        return nil, fmt.Errorf("JSON unmarshal error: %v", err)
    }
    // 判断是否有CNI_COMMAND变量
    cmd, ok := cr.Env[cniutil.CNI_COMMAND]
    if !ok {
        return nil, fmt.Errorf("Unexpected or missing %s", cniutil.CNI_COMMAND)
    }
    // 初始化PodRequest对象
    req := &PodRequest{
        Command: cmd,
        Result:  make(chan *PodResult),
        CmdArgs: &skel.CmdArgs{
            StdinData: cr.Config,
        },
    }
    // 获取CNI请求其它环境变量
    req.ContainerID, ok = cr.Env[cniutil.CNI_CONTAINERID]
    if !ok {
        return nil, fmt.Errorf("missing %s", cniutil.CNI_CONTAINERID)
    }
    req.Netns, ok = cr.Env[cniutil.CNI_NETNS]
    if !ok {
        return nil, fmt.Errorf("missing %s", cniutil.CNI_NETNS)
    }
    req.IfName, ok = cr.Env[cniutil.CNI_IFNAME]
    if !ok {
        return nil, fmt.Errorf("missing %s", cniutil.CNI_IFNAME)
    }
    req.Path, ok = cr.Env[cniutil.CNI_PATH]
    if !ok {
        return nil, fmt.Errorf("missing %s", cniutil.CNI_PATH)
    }
    req.Args, ok = cr.Env[cniutil.CNI_ARGS]
    if !ok {
        return nil, fmt.Errorf("missing %s", cniutil.CNI_ARGS)
    }
    // 解析CNIArgs环境变量；格式key1=val1;key2=val2
    cniArgs, err := cniutil.ParseCNIArgs(req.Args)
    if err != nil {
        return nil, err
    }
    // 获取K8S_POD_NAMESPACE变量
    req.PodNamespace, ok = cniArgs[k8s.K8S_POD_NAMESPACE]
    if !ok {
        return nil, fmt.Errorf("missing %s", k8s.K8S_POD_NAMESPACE)
    }
    // 获取K8S_POD_NAME变量
    req.PodName, ok = cniArgs[k8s.K8S_POD_NAME]
    if !ok {
        return nil, fmt.Errorf("missing %s", k8s.K8S_POD_NAME)
    }
    glog.V(4).Infof("req.Args %s req.StdinData %s", req.Args, cr.Config)

    return req, nil
}
```

调用g.requestFunc(req)
```
// #lizard forgives
func (g *Galaxy) requestFunc(req *galaxyapi.PodRequest) (data []byte, err error) {
    // 打印开始时间
    start := time.Now()
    glog.Infof("%v, %s+", req, start.Format(time.StampMicro))
    // ADD操作
    if req.Command == cniutil.COMMAND_ADD {
        // 打印结束时间
        defer func() {
            glog.Infof("%v, data %s, err %v, %s-", req, string(data), err, start.Format(time.StampMicro))
        }()
        var pod *corev1.Pod
        // 通过clientSet获取pod对象
        pod, err = g.getPod(req.PodName, req.PodNamespace)
        if err != nil {
            return
        }
        // 调用cmdAdd
        result, err1 := g.cmdAdd(req, pod)
        if err1 != nil {
            err = err1
            return
        } else {
            // 结果转换为0.2.0版本的结果，也校验下IP合法性
            result020, err2 := convertResult(result)
            if err2 != nil {
                err = err2
            } else {
                data, err = json.Marshal(result)
                if err != nil {
                    return
                }
                // 设置hostPort端口转发, 保存端口映射信息至/var/lib/cni/galaxy/port/$ContainerID
                err = g.setupPortMapping(req, req.ContainerID, result020, pod)
                if err != nil {
                    // 设置失败的话，就清除hostPort端口转发
                    g.cleanupPortMapping(req)
                    return
                }
                // pod IP回写到Status
                pod.Status.PodIP = result020.IP4.IP.IP.String()
                // 如果启用NetworkPolicy，同步下iptables/ipset规则
                if g.pm != nil {
                    if err := g.pm.SyncPodChains(pod); err != nil {
                        glog.Warning(err)
                    }
                    g.pm.SyncPodIPInIPSet(pod, true)
                }
            }
        }
      // DEL操作
    } else if req.Command == cniutil.COMMAND_DEL {
        // 打印结束时间
        defer glog.Infof("%v err %v, %s-", req, err, start.Format(time.StampMicro))
        err = cniutil.CmdDel(req.CmdArgs, -1)
        if err == nil {
            // 清除hostPort端口转发
            err = g.cleanupPortMapping(req)
        }
    } else {
        err = fmt.Errorf("unknown command %s", req.Command)
    }
    return
}
```

ADD操作最终调用g.cmdAdd(req, pod)
```
func (g *Galaxy) cmdAdd(req *galaxyapi.PodRequest, pod *corev1.Pod) (types.Result, error) {
    // 解析网络类型参数
    networkInfos, err := g.resolveNetworks(req, pod)
    if err != nil {
        return nil, err
    }
    // 调用CmdAdd
    return cniutil.CmdAdd(req.CmdArgs, networkInfos)
}

// CmdAdd saves networkInfos to disk and executes each cni binary to setup network
func CmdAdd(cmdArgs *skel.CmdArgs, networkInfos []*NetworkInfo) (types.Result, error) {
    if len(networkInfos) == 0 {
        return nil, fmt.Errorf("No network info returned")
    }
    // 把网络类型信息写入/var/lib/cni/galaxy/$ContainerID
    if err := saveNetworkInfo(cmdArgs.ContainerID, networkInfos); err != nil {
        return nil, fmt.Errorf("Error save network info %v for %s: %v", networkInfos, cmdArgs.ContainerID, err)
    }
    var (
        err    error
        result types.Result
    )
    for idx, networkInfo := range networkInfos {
        //append additional args from network info
        cmdArgs.Args = strings.TrimRight(fmt.Sprintf("%s;%s", cmdArgs.Args, BuildCNIArgs(networkInfo.Args)), ";")
        // 保存上一个结果
        if result != nil {
            networkInfo.Conf["prevResult"] = result
        }
        // 调用DelegateAdd
        result, err = DelegateAdd(networkInfo.Conf, cmdArgs, networkInfo.IfName)
        if err != nil {
            //fail to add cni, then delete all established CNIs recursively
            glog.Errorf("fail to add network %s: %v, begin to rollback and delete it", networkInfo.Args, err)
            // 调用失败的话，直接调用CmdDel
            delErr := CmdDel(cmdArgs, idx)
            glog.Warningf("fail to delete cni in rollback %v", delErr)
            return nil, fmt.Errorf("fail to establish network %s:%v", networkInfo.Args, err)
        }
    }
    if err != nil {
        return nil, err
    }
    return result, nil
}

// DelegateAdd calles delegate cni binary to execute cmdAdd
func DelegateAdd(netconf map[string]interface{}, args *skel.CmdArgs, ifName string) (types.Result, error) {
    netconfBytes, err := json.Marshal(netconf)
    if err != nil {
        return nil, fmt.Errorf("error serializing delegate netconf: %v", err)
    }
    // 在cni插件的目录下寻找对应的cni插件路径
    pluginPath, err := invoke.FindInPath(netconf["type"].(string), strings.Split(args.Path, ":"))
    if err != nil {
        return nil, err
    }
    //
    glog.Infof("delegate add %s args %s conf %s", args.ContainerID, args.Args, string(netconfBytes))
    // 调用cni标准库完成ADD操作
    return invoke.ExecPluginWithResult(pluginPath, netconfBytes, &invoke.Args{
        Command:       "ADD",
        ContainerID:   args.ContainerID,
        NetNS:         args.Netns,
        PluginArgsStr: args.Args,
        IfName:        ifName,
        Path:          args.Path,
    })
}
```

DEL操作最终调用CmdDel
```
// CmdDel restores networkInfos from disk and executes each cni binary to delete network
func CmdDel(cmdArgs *skel.CmdArgs, lastIdx int) error {
    // 读取/var/lib/cni/galaxy/$ContainerID，获取对应的网络类型
    networkInfos, err := consumeNetworkInfo(cmdArgs.ContainerID)
    if err != nil {
        if os.IsNotExist(err) {
            // Duplicated cmdDel invoked by kubelet
            return nil
        }
        return fmt.Errorf("Error consume network info %v for %s: %v", networkInfos, cmdArgs.ContainerID, err)
    }
    if lastIdx == -1 {
        lastIdx = len(networkInfos) - 1
    }
    // 维护一个error slice
    var errorSet []string
    var fails []*NetworkInfo
    for idx := lastIdx; idx >= 0; idx-- {
        networkInfo := networkInfos[idx]
        //append additional args from network info
        cmdArgs.Args = strings.TrimRight(fmt.Sprintf("%s;%s", cmdArgs.Args, BuildCNIArgs(networkInfo.Args)), ";")
        err := DelegateDel(networkInfo.Conf, cmdArgs, networkInfo.IfName)
        if err != nil {
            errorSet = append(errorSet, err.Error())
            fails = append(fails, networkInfo)
            glog.Errorf("failed to delete network %v: %v", networkInfo.Args, err)
        }
    }
    if len(errorSet) > 0 {
        reverse(fails)
        // 把网络类型信息写入/var/lib/cni/galaxy/$ContainerID
        if err := saveNetworkInfo(cmdArgs.ContainerID, fails); err != nil {
            glog.Warningf("Error save network info %v for %s: %v", fails, cmdArgs.ContainerID, err)
        }
        return fmt.Errorf(strings.Join(errorSet, " / "))
    }
    return nil
}

// DelegateDel calles delegate cni binary to execute cmdDEL
func DelegateDel(netconf map[string]interface{}, args *skel.CmdArgs, ifName string) error {
    netconfBytes, err := json.Marshal(netconf)
    if err != nil {
        return fmt.Errorf("error serializing delegate netconf: %v", err)
    }
    // 在cni插件的目录下寻找对应的cni插件路径
    pluginPath, err := invoke.FindInPath(netconf["type"].(string), strings.Split(args.Path, ":"))
    if err != nil {
        return err
    }
    glog.Infof("delegate del %s args %s conf %s", args.ContainerID, args.Args, string(netconfBytes))
    // 调用cni标准库完成DEL操作
    return invoke.ExecPluginWithoutResult(pluginPath, netconfBytes, &invoke.Args{
        Command:       "DEL",
        ContainerID:   args.ContainerID,
        NetNS:         args.Netns,
        PluginArgsStr: args.Args,
        IfName:        ifName,
        Path:          args.Path,
    })
}
```

#### galaxy sdn

```
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io/ioutil"
    "net"
    "net/http"
    "os"
    "strings"

    "github.com/containernetworking/cni/pkg/skel"
    t020 "github.com/containernetworking/cni/pkg/types/020"
    "github.com/containernetworking/cni/pkg/version"
    galaxyapi "tkestack.io/galaxy/pkg/api/galaxy"
    "tkestack.io/galaxy/pkg/api/galaxy/private"
)

// cniPlugin结构体定义
type cniPlugin struct {
    socketPath string
}

// 初始化函数
func NewCNIPlugin(socketPath string) *cniPlugin {
    return &cniPlugin{socketPath: socketPath}
}

// Create and fill a CNIRequest with this plugin's environment and stdin which
// contain the CNI variables and configuration
// 构建CNIRequest对象
func newCNIRequest(args *skel.CmdArgs) *galaxyapi.CNIRequest {
    envMap := make(map[string]string)
    for _, item := range os.Environ() {
        idx := strings.Index(item, "=")
        if idx > 0 {
            envMap[strings.TrimSpace(item[:idx])] = item[idx+1:]
        }
    }
    // envMap存储系统的环境变量
    return &galaxyapi.CNIRequest{
        Env:    envMap,
        Config: args.StdinData,
    }
}

// Send a CNI request to the CNI server via JSON + HTTP over a root-owned unix socket,
// and return the result
func (p *cniPlugin) doCNI(url string, req *galaxyapi.CNIRequest) ([]byte, error) {
    data, err := json.Marshal(req)
    if err != nil {
        return nil, fmt.Errorf("failed to marshal CNI request %v: %v", req, err)
    }
    // 初始化http Client对象，地址为unix套接字/var/run/galaxy/galaxy.sock
    client := &http.Client{
        Transport: &http.Transport{
            Dial: func(proto, addr string) (net.Conn, error) {
                return net.Dial("unix", p.socketPath)
            },
        },
    }
    // http请求
    resp, err := client.Post(url, "application/json", bytes.NewReader(data))
    if err != nil {
        return nil, fmt.Errorf("failed to send CNI request: %v", err)
    }
    defer resp.Body.Close() // nolint: errcheck

    body, err := ioutil.ReadAll(resp.Body)
    if err != nil {
        return nil, fmt.Errorf("failed to read CNI result: %v", err)
    }

    if resp.StatusCode != 200 {
        return nil, fmt.Errorf("galaxy returns: %s", string(body))
    }

    return body, nil
}

// Send the ADD command environment and config to the CNI server, returning
// the IPAM result to the caller
func (p *cniPlugin) CmdAdd(args *skel.CmdArgs) (*t020.Result, error) {
    body, err := p.doCNI("http://dummy/cni", newCNIRequest(args))
    if err != nil {
        return nil, err
    }
    // body解析为0.2.0版本的result
    result := &t020.Result{}
    if err := json.Unmarshal(body, result); err != nil {
        return nil, fmt.Errorf("failed to unmarshal response '%s': %v", string(body), err)
    }

    return result, nil
}

// Send the ADD command environment and config to the CNI server, printing
// the IPAM result to stdout when called as a CNI plugin
func (p *cniPlugin) skelCmdAdd(args *skel.CmdArgs) error {
    result, err := p.CmdAdd(args)
    if err != nil {
        return err
    }
    // 标准输出打印
    return result.Print()
}

// Send the DEL command environment and config to the CNI server
// 删除操作
func (p *cniPlugin) CmdDel(args *skel.CmdArgs) error {
    _, err := p.doCNI("http://dummy/cni", newCNIRequest(args))
    return err
}

// 主函数
func main() {
    p := NewCNIPlugin(private.GalaxySocketPath)
    skel.PluginMain(p.skelCmdAdd, p.CmdDel, version.Legacy)
}
```

#### galaxy ipam

```
func main() {
    // initialize rand seed
    rand.Seed(time.Now().UTC().UnixNano())

    s := server.NewServer()
    // add command line args
    s.AddFlags(pflag.CommandLine)

    flag.InitFlags()
    //日志初始化，默认每隔5秒钟flush下pending的log I/O
    logs.InitLogs()
    defer logs.FlushLogs()

    // if checking version, print it and exit
    ldflags.PrintAndExitIfRequested()

    if err := s.Start(); err != nil {
        fmt.Fprintf(os.Stderr, "%v\n", err) // nolint: errcheck
        os.Exit(1)
    }
    //TODO handle signal ?
}
```
1. 设置随机数种子
2. 初始化server对象
3. 初始化server命令行参数
4. 是否打印版本信息
5. 启动server程序
6. 监听退出信号，终止server程序(TODO?)

Server结构体
```
type JsonConf struct {
    SchedulePluginConf schedulerplugin.Conf `json:"schedule_plugin"`
}

type Server struct {
        //调度相关配置
    JsonConf
    //API server启动参数
    *options.ServerRunOptions
    client               kubernetes.Interface
    crdClient            versioned.Interface
    tappClient           tappVersioned.Interface
    extensionClient      extensionClient.Interface
    plugin               *schedulerplugin.FloatingIPPlugin
    informerFactory      informers.SharedInformerFactory
    crdInformerFactory   crdInformer.SharedInformerFactory
    tappInformerFactory  tappInformers.SharedInformerFactory
    stopChan             chan struct{}
    leaderElectionConfig *leaderelection.LeaderElectionConfig
}
```

s.Start()函数
```
func (s *Server) Start() error {
    // 初始化Server变量
    if err := s.init(); err != nil {
        return fmt.Errorf("init server: %v", err)
    }

    if s.LeaderElection.LeaderElect && s.leaderElectionConfig != nil {
        leaderelection.RunOrDie(context.Background(), *s.leaderElectionConfig)
        return nil
    }
    return s.Run()
}
```

Server的init函数
```
func (s *Server) init() error {
    if options.JsonConfigPath == "" {
        return fmt.Errorf("json config is required")
    }
    // 解析JsonConf
    data, err := ioutil.ReadFile(options.JsonConfigPath)
    if err != nil {
        return fmt.Errorf("read json config: %v", err)
    }
    if err := json.Unmarshal(data, &s.JsonConf); err != nil {
        return fmt.Errorf("bad config %s: %v", string(data), err)
    }
    // 初始化k8s client、ipam crd client、extensionClient、tappClient、leaderElectionConfig参数
    s.initk8sClient()
    // 初始化informerFactory
    s.informerFactory = informers.NewFilteredSharedInformerFactory(s.client, time.Minute, v1.NamespaceAll, nil)
    // 初始化podInformer、statefulsetInformer、deploymentInformer
    podInformer := s.informerFactory.Core().V1().Pods()
    statefulsetInformer := s.informerFactory.Apps().V1().StatefulSets()
    deploymentInformer := s.informerFactory.Apps().V1().Deployments()
    // 初始化crdInformerFactory，crd资源用crd的informer来创建
    s.crdInformerFactory = crdInformer.NewSharedInformerFactory(s.crdClient, 0)
    // 初始化poolInformer、fipInformer
    poolInformer := s.crdInformerFactory.Galaxy().V1alpha1().Pools()
    fipInformer := s.crdInformerFactory.Galaxy().V1alpha1().FloatingIPs()
    // 初始化PluginFactoryArgs对象
    pluginArgs := &schedulerplugin.PluginFactoryArgs{
        PodLister:         podInformer.Lister(),
        StatefulSetLister: statefulsetInformer.Lister(),
        DeploymentLister:  deploymentInformer.Lister(),
        Client:            s.client,
        TAppClient:        s.tappClient,
        PodHasSynced:      podInformer.Informer().HasSynced,
        StatefulSetSynced: statefulsetInformer.Informer().HasSynced,
        DeploymentSynced:  deploymentInformer.Informer().HasSynced,
        PoolLister:        poolInformer.Lister(),
        PoolSynced:        poolInformer.Informer().HasSynced,
        CrdClient:         s.crdClient,
        ExtClient:         s.extensionClient,
        FIPInformer:       fipInformer,
    }
    if s.tappClient != nil {
        s.tappInformerFactory = tappInformers.NewSharedInformerFactory(s.tappClient, time.Minute)
        tappInformer := s.tappInformerFactory.Tappcontroller().V1().TApps()
        pluginArgs.TAppLister = tappInformer.Lister()
        pluginArgs.TAppHasSynced = tappInformer.Informer().HasSynced
    }
    // 初始化FloatingIPPlugin对象
    s.plugin, err = schedulerplugin.NewFloatingIPPlugin(s.SchedulePluginConf, pluginArgs)
    if err != nil {
        return err
    }
    // podInformer设置EventHandler
    // AddEventHandler函数的参数类型是一个叫ResourceEventHandler的interface
    podInformer.Informer().AddEventHandler(eventhandler.NewPodEventHandler(s.plugin))
    return nil
}
```

初始化FloatingIPPlugin对象的函数
```
// Conf结构体
type Conf struct {
    FloatingIPs           []*floatingip.FloatingIPPool `json:"floatingips,omitempty"`
    ResyncInterval        uint                         `json:"resyncInterval"`
    ConfigMapName         string                       `json:"configMapName"`
    ConfigMapNamespace    string                       `json:"configMapNamespace"`
    FloatingIPKey         string                       `json:"floatingipKey"`       // configmap floatingip data key
    SecondFloatingIPKey   string                       `json:"secondFloatingipKey"` // configmap second floatingip data key
    CloudProviderGRPCAddr string                       `json:"cloudProviderGrpcAddr"`
}

// NewFloatingIPPlugin creates FloatingIPPlugin
func NewFloatingIPPlugin(conf Conf, args *PluginFactoryArgs) (*FloatingIPPlugin, error) {
    // conf对象变量的校验
    conf.validate()
    glog.Infof("floating ip config: %v", conf)
    plugin := &FloatingIPPlugin{
        nodeSubnet:        make(map[string]*net.IPNet),
        PluginFactoryArgs: args,
        conf:              &conf,
        unreleased:        make(chan *releaseEvent, 1000),
        dpLockPool:        keymutex.NewHashed(500000),
        podLockPool:       keymutex.NewHashed(500000),
    }
    // 初始化crdIpam对象，设置FIPInformer的EventHandler
    plugin.ipam = floatingip.NewCrdIPAM(args.CrdClient, floatingip.InternalIp, plugin.FIPInformer)
    // we can't add two event handler for the same informer.
    // The later registed event handler will replace the former one, So pass nil informer to secondIPAM
    // TODO remove secondIPAM and let ipam do allocating all ips
    // 外部IP不设置FIPInformer的EventHandler
    plugin.secondIPAM = floatingip.NewCrdIPAM(args.CrdClient, floatingip.ExternalIp, nil)
    plugin.hasSecondIPConf.Store(false)
    // 初始化cloudProvider(客户端)，连接到第三方公有云的grpc server
    if conf.CloudProviderGRPCAddr != "" {
        plugin.cloudProvider = cloudprovider.NewGRPCCloudProvider(conf.CloudProviderGRPCAddr)
    }
    return plugin, nil
}
```

为podInformer设置Event的AddEventHandler, 实际上是实现的ResourceEventHandler接口的对象
```
// ResourceEventHandler接口
type ResourceEventHandler interface {
    OnAdd(obj interface{})
    OnUpdate(oldObj, newObj interface{})
    OnDelete(obj interface{})
}

// PodEventHandler实现了ResourceEventHandler接口
func NewPodEventHandler(watcher PodWatcher) *PodEventHandler {
    return &PodEventHandler{watcher: watcher}
}

// NewPodEventHandler的参数类型PodWatcher也是一个接口类型
// FloatingIPPlugin/PolicyManager对象都实现了PodWatcher接口
type PodWatcher interface {
    AddPod(pod *corev1.Pod) error
    UpdatePod(oldPod, newPod *corev1.Pod) error
    DeletePod(pod *corev1.Pod) error
}
```

上述初始化参数都完成，进入Server Run函数
```
// *s.leaderElectionConfig里面的OnStartedLeading回调函数是s.Run()
func (s *Server) Run() error {
    // 启动informer
    go s.informerFactory.Start(s.stopChan)
    go s.crdInformerFactory.Start(s.stopChan)
    if s.tappInformerFactory != nil {
        go s.tappInformerFactory.Start(s.stopChan)
    }
    // 确保创建floatingip和pool的crd
    if err := crd.EnsureCRDCreated(s.extensionClient); err != nil {
        return err
    }
    // FloatingIPPlugin初始化
    if err := s.plugin.Init(); err != nil {
        return err
    }
    // 启动FloatingIPPlugin
    s.plugin.Run(s.stopChan)
    // 创建/v1/ip /v1/pool路由
    go s.startAPIServer()
    // 创建/v1/filter、/v1/priority、/v1/bind、/v1/healthy路由
    s.startServer()
    return nil
}
```

FloatingIPPlugin初始化
```
// Init retrieves floatingips from json config or config map and calls ipam to update
func (p *FloatingIPPlugin) Init() error {
    // Conf结构体变量, 从galaxy-ipam-etc configmap中的galaxy-ipam.json解析
    if len(p.conf.FloatingIPs) > 0 {
        if err := p.ipam.ConfigurePool(p.conf.FloatingIPs); err != nil {
            return err
        }
    } else {
        // 如果galaxy-ipam.json配置文件没有配置floatingips，从floatingip-config cm中查找
        glog.Infof("empty floatingips from config, fetching from configmap")
        if err := wait.PollInfinite(time.Second, func() (done bool, err error) {
            updated, err := p.updateConfigMap()
            if err != nil {
                glog.Warning(err)
            }
            return updated, nil
        }); err != nil {
            return fmt.Errorf("failed to get floatingip config from configmap: %v", err)
        }
    }
    // 等待informer的cache同步
    wait.PollInfinite(time.Second, func() (done bool, err error) {
        glog.Infof("waiting store ready")
        return p.storeReady(), nil
    })
    glog.Infof("store is ready, plugin init done")
    return nil
}
```

进入FloatingIPPlugin的Run函数
```
// Run starts resyncing pod routine
func (p *FloatingIPPlugin) Run(stop chan struct{}) {
    // 再次从floatingip-config cm中查找
    if len(p.conf.FloatingIPs) == 0 {
        go wait.Until(func() {
            if _, err := p.updateConfigMap(); err != nil {
                glog.Warning(err)
            }
        }, time.Minute, stop)
    }
    firstTime := true
    go wait.Until(func() {
        if firstTime {
            glog.Infof("start resyncing for the first time")
            defer glog.Infof("resyncing complete for the first time")
            firstTime = false
        }
        // 重新同步pod已分配的IP
        if err := p.resyncPod(p.ipam); err != nil {
            glog.Warningf("[%s] %v", p.ipam.Name(), err)
        }
        // 是否启用第二个IP
        if p.hasSecondIPConf.Load().(bool) {
            if err := p.resyncPod(p.secondIPAM); err != nil {
                glog.Warningf("[%s] %v", p.secondIPAM.Name(), err)
            }
        }
        p.syncPodIPsIntoDB()
    }, time.Duration(p.conf.ResyncInterval)*time.Minute, stop)
    for i := 0; i < 5; i++ {
        go p.loop(stop)
    }
}
```

resyncPod函数
```
// IPAM存储的key对象定义
type KeyObj struct {
    // stores the key format in IPAM
    // for deployment dp_namespace_deploymentName_podName,
    // for pool pool__poolName_dp_namespace_deploymentName_podName, for statefulset
    // sts_namespace_statefulsetName_podName
    // If deployment name is 63 bytes, e.g. dp1234567890dp1234567890dp1234567890dp1234567890dp1234567890dp1
    // deployment pod name will be 63 bytes with modified suffix, e.g.
    // dp1234567890dp1234567890dp1234567890dp1234567890dp1234567848p74
    // So we can't get deployment name from pod name and have to store deployment name with pod name
    KeyInDB       string
    AppName       string
    AppTypePrefix string
    PodName       string
    Namespace     string
    // the annotation value if pod has pool annotation
    PoolName string
}

type resyncObj struct {
    keyObj *util.KeyObj
    fip    floatingip.FloatingIP
}

type resyncMeta struct {
    allocatedIPs map[string]resyncObj // allocated ips from galaxy pool
    existPods    map[string]*corev1.Pod
    tappMap      map[string]*tappv1.TApp
    ssMap        map[string]*appv1.StatefulSet
}

// resyncPod releases ips from
// 1. deleted pods whose parent app does not exist
// 2. deleted pods whose parent deployment or statefulset exist but is not ip immutable
// 3. deleted pods whose parent deployment no need so many ips
// 4. deleted pods whose parent statefulset/tapp exist but pod index > .spec.replica
// 5. existing pods but its status is evicted
func (p *FloatingIPPlugin) resyncPod(ipam floatingip.IPAM) error {
    glog.V(4).Infof("resync pods+")
    defer glog.V(4).Infof("resync pods-")
    resyncMeta := &resyncMeta{
        allocatedIPs: make(map[string]resyncObj),
    }
    // 检测未被分配的浮动IP池里的所有IP, 根据fip.Key解析为keyObj对象
    // 过滤keyObj.PodName、keyObj.AppName为空，然后放入allocatedIPs map
    if err := p.fetchChecklist(ipam, resyncMeta); err != nil {
        return err
    }
    // 初始化resyncMeta的existPods、tappMap、ssMap变量
    if err := p.fetchAppAndPodMeta(resyncMeta); err != nil {
        return err
    }
    // 重新同步已配分的IP
    p.resyncAllocatedIPs(ipam, resyncMeta)
    return nil
}
```

/v1/filter、/v1/priority、/v1/bind、/v1/healthy路由(实现scheduler extender webhook的方式)
```
// /v1/filter路由 优选函数
func (s *Server) filter(request *restful.Request, response *restful.Response) {
    args := new(schedulerapi.ExtenderArgs)
    if err := request.ReadEntity(&args); err != nil {
        glog.Error(err)
        _ = response.WriteError(http.StatusInternalServerError, err)
        return
    }
    glog.V(5).Infof("POST filter %v", *args)
    start := time.Now()
    glog.V(3).Infof("filtering %s_%s, start at %d+", args.Pod.Name, args.Pod.Namespace, start.UnixNano())
    // 调用FloatingIPPlugin的Filter函数，过滤没有足够浮动IP的节点
    filteredNodes, failedNodesMap, err := s.plugin.Filter(&args.Pod, args.Nodes.Items)
    glog.V(3).Infof("filtering %s_%s, start at %d-", args.Pod.Name, args.Pod.Namespace, start.UnixNano())
    args.Nodes.Items = filteredNodes
    errStr := ""
    if err != nil {
        errStr = err.Error()
    }
    _ = response.WriteEntity(schedulerapi.ExtenderFilterResult{
        Nodes:       args.Nodes,
        FailedNodes: failedNodesMap,
        Error:       errStr,
    })
}

// /v1/priority路由  打分函数
func (s *Server) priority(request *restful.Request, response *restful.Response) {
    args := new(schedulerapi.ExtenderArgs)
    if err := request.ReadEntity(&args); err != nil {
        glog.Error(err)
        _ = response.WriteError(http.StatusInternalServerError, err)
        return
    }
    glog.V(5).Infof("POST priority %v", *args)
    // 调用FloatingIPPlugin的Prioritize函数，实际上什么都没做？
    hostPriorityList, err := s.plugin.Prioritize(&args.Pod, args.Nodes.Items)
    if err != nil {
        glog.Warningf("prioritize err: %v", err)
    }
    _ = response.WriteEntity(*hostPriorityList)
}

// /v1/bind路由  绑定函数
func (s *Server) bind(request *restful.Request, response *restful.Response) {
    args := new(schedulerapi.ExtenderBindingArgs)
    if err := request.ReadEntity(&args); err != nil {
        glog.Error(err)
        _ = response.WriteError(http.StatusInternalServerError, err)
        return
    }
    glog.V(5).Infof("POST bind %v", *args)
    start := time.Now()
    glog.V(3).Infof("binding %s_%s to %s, start at %d+", args.PodName, args.PodNamespace, args.Node, start.UnixNano())
    // 调用FloatingIPPlugin的Bind函数，
    err := s.plugin.Bind(args)
    glog.V(3).Infof("binding %s_%s to %s, start at %d-", args.PodName, args.PodNamespace, args.Node, start.UnixNano())
    var result schedulerapi.ExtenderBindingResult
    if err != nil {
        glog.Warningf("bind err: %v", err)
        result.Error = err.Error()
    }
    _ = response.WriteEntity(result)
}

// /v1/healthy路由
func (s *Server) healthy(request *restful.Request, response *restful.Response) {
    response.WriteHeader(http.StatusOK)
    _, _ = response.Write([]byte("ok"))
}
```

没有在cni插件中指定ipam，pod是如何获取到ip呢？pod如果启用eniNetwork，在galaxy-ipam调度过程bind阶段会为每个pod的annotation带上网络信息，格式如`k8s.v1.cni.galaxy.io/args: '{"common":{"ipinfos":[{"ip":"19.16.104.163/24","vlan":0,"gateway":"19.16.104.254"}]}}'`，
galaxy-sdn cni插件会发请求至`http://dummy/cni`, galaxy server会收到该请求，最终调用到`cniutil.CmdAdd`

```
# github.com/yaoice/galaxy/pkg/galaxy/server.go
installHandlers -> g.cni -> g.requestFunc -> g.cmdAdd -> cniutil.CmdAdd

// CmdAdd saves networkInfos to disk and executes each cni binary to setup network
func CmdAdd(cmdArgs *skel.CmdArgs, networkInfos []*NetworkInfo) (types.Result, error) {
    if len(networkInfos) == 0 {
        return nil, fmt.Errorf("No network info returned")
    }
    if err := saveNetworkInfo(cmdArgs.ContainerID, networkInfos); err != nil {
        return nil, fmt.Errorf("Error save network info %v for %s: %v", networkInfos, cmdArgs.ContainerID, err)
    }
    var (
        err    error
        result types.Result
    )
    for idx, networkInfo := range networkInfos {
        //append additional args from network info
        // networkInfo的地址信息赋值给cmdArgs.Args
        cmdArgs.Args = strings.TrimRight(fmt.Sprintf("%s;%s", cmdArgs.Args, BuildCNIArgs(networkInfo.Args)), ";")
        if result != nil {
            networkInfo.Conf["prevResult"] = result
        }
        // 继续调用其它cni插件执行cmdAdd
        result, err = DelegateAdd(networkInfo.Conf, cmdArgs, networkInfo.IfName)
        if err != nil {
            //fail to add cni, then delete all established CNIs recursively
            glog.Errorf("fail to add network %s: %v, begin to rollback and delete it", networkInfo.Args, err)
            delErr := CmdDel(cmdArgs, idx)
            glog.Warningf("fail to delete cni in rollback %v", delErr)
            return nil, fmt.Errorf("fail to establish network %s:%v", networkInfo.Args, err)
        }
    }
    if err != nil {
        return nil, err
    }
    return result, nil
}

# k8s vlan插件
func cmdAdd(args *skel.CmdArgs) error {
    conf, err := d.LoadConf(args.StdinData)
    if err != nil {
        return err
    }
    // args里携带了上面的网络地址信息
    vlanIds, results, err := ipam.Allocate(conf.IPAM.Type, args)
    ......
}

const (
    IPInfosKey = "ipinfos"
)

// Allocate tries to find IPInfo from args firstly
// Otherwise invoke third party ipam binaries
func Allocate(ipamType string, args *skel.CmdArgs) ([]uint16, []types.Result, error) {
    var (
        vlanId uint16
        err    error
    )
    // 解析args.Args
    kvMap, err := cniutil.ParseCNIArgs(args.Args)
    if err != nil {
        return nil, nil, err
    }
    var results []types.Result
    var vlanIDs []uint16
    // 获取ipinfos key对应的地址信息
    // 格式：'{"common":{"ipinfos":[{"ip":"19.16.104.163/24","vlan":0,"gateway":"19.16.104.254"}]}}'
    if ipInfoStr := kvMap[constant.IPInfosKey]; ipInfoStr != "" {
        // get ipinfo from cni args
        var ipInfos []constant.IPInfo
        if err := json.Unmarshal([]byte(ipInfoStr), &ipInfos); err != nil {
            return nil, nil, fmt.Errorf("failed to unmarshal ipInfo from args %q: %v", args.Args, err)
        }
    ......
}
```
通过scheduler bind阶段把网络地址信息记录在pod的annotation上，然后再通过kubelet加载的galaxy-sdn cni插件把cni请求截获发到galaxy server端，
解析pod的annotation提取网络地址信息，用于构建cni请求的CmdArgs，最后再去请求对应的cni插件

#### 固定IP如何实现

```go
apiVersion: galaxy.k8s.io/v1alpha1
kind: FloatingIP
metadata:
  name: 19.16.104.15
  selfLink: /apis/galaxy.k8s.io/v1alpha1/floatingips/19.16.104.15
  uid: d360cf8c-6b34-4a82-bffb-c5e2951d1249
spec:
  attribute: '{"NodeName":"12.16.0.6","Uid":"0f136ed1-6154-4c93-889c-9328fb273e47"}'
  key: dp_default_double-interface-deployment_double-interface-deployment-698d96ff8b-smnh7
  policy: 2
```
ip可以key产生对应关系，key由工作负载类型、浮动IP池、命名空间工作负载名、pod名组合而成，
当配置了`k8s.v1.cni.galaxy.io/release-policy: "never"`策略后，表明IP不释放。
如何保证ip被这个工作负载再利用呢？如果删除了这个工作负载，这个浮动IP的cr还在，key变为范匹配`dp_default_double-interface-deployment_`



在什么时候什么地方修改浮动IP cr的key呢？在删除pod的时候，看下在哪里监听这个事件，FloatingIPPlugin Run函数最终会进入loop函数，一直监听p.unreleased的事件.

```go
func (p *FloatingIPPlugin) Run -> func (p *FloatingIPPlugin) loop(stop chan struct{})
```

```go
//监听p.unreleased的事件
// loop pulls release event from chan and calls unbind to unbind pod
func (p *FloatingIPPlugin) loop(stop chan struct{}) {
    for {
        select {
        case <-stop:
            return
        case event := <-p.unreleased:
            go func(event *releaseEvent) {
                if err := p.unbind(event.pod); err != nil {
                    event.retryTimes++
                    if event.retryTimes > 3 {
                        // leave it to resync to protect chan from explosion
                        glog.Errorf("abort unbind for pod %s, retried %d times: %v", util.PodName(event.pod),
                            event.retryTimes, err)
                    } else {
                        glog.Warningf("unbind pod %s failed for %d times: %v", util.PodName(event.pod),
                            event.retryTimes, err)
                        // backoff time if required
                        time.Sleep(100 * time.Millisecond * time.Duration(event.retryTimes))
                        p.unreleased <- event
                    }
                }
            }(event)
        }
    }
}
```

p.unreleased事件从哪里传来？是从FloatingIPPlugin对象

```go
//galaxy server启动了一个podInformer，监听pod事件
//s.plugin=FloatingIPPlugin
s.PodInformer.Informer().AddEventHandler(eventhandler.NewPodEventHandler(s.plugin))
```

```go
//FloatingIPPlugin实现了PodWatcher接口
// AddPod does nothing
func (p *FloatingIPPlugin) AddPod(pod *corev1.Pod) error {
    return nil
}

// UpdatePod syncs pod ip with ipam
func (p *FloatingIPPlugin) UpdatePod(oldPod, newPod *corev1.Pod) error {
    if !p.hasResourceName(&newPod.Spec) {
        return nil
    }
    if !finished(oldPod) && finished(newPod) {
        // Deployments will leave evicted pods
        // If it's a evicted one, release its ip
        glog.Infof("release ip from %s_%s, phase %s", newPod.Name, newPod.Namespace, string(newPod.Status.Phase))
        p.unreleased <- &releaseEvent{pod: newPod}
        return nil
    }
    if err := p.syncPodIP(newPod); err != nil {
        glog.Warningf("failed to sync pod ip: %v", err)
    }
    return nil
}

// DeletePod unbinds pod from ipam
func (p *FloatingIPPlugin) DeletePod(pod *corev1.Pod) error {
    if !p.hasResourceName(&pod.Spec) {
        return nil
    }
    glog.Infof("handle pod delete event: %s_%s", pod.Name, pod.Namespace)
    p.unreleased <- &releaseEvent{pod: pod}
    return nil
}

//PodWatcher接口
type PodWatcher interface {
    AddPod(pod *corev1.Pod) error
    UpdatePod(oldPod, newPod *corev1.Pod) error
    DeletePod(pod *corev1.Pod) error
}
```

一旦收到p.unreleased的事件，就会执行p.unbind(event.pod)

```go
func (p *FloatingIPPlugin) lockPod(name, namespace string) func() {
    key := fmt.Sprintf("%s_%s", namespace, name)
    start := time.Now()
    p.podLockPool.LockKey(key)
    elapsed := (time.Now().UnixNano() - start.UnixNano()) / 1e6
    if elapsed > 500 {
        glog.Infof("acquire lock for %s took %d ms, started at %s, %s", key, elapsed,
            start.Format("15:04:05.000"), getCaller())
    }
    return func() {
        _ = p.podLockPool.UnlockKey(key)
    }
}

// unbind release ip from pod
func (p *FloatingIPPlugin) unbind(pod *corev1.Pod) error {
    //先执行lockPod函数里面的语句，然后再执行unbind函数里面的非defer语句，最后再执行unbind的returen func
    defer p.lockPod(pod.Name, pod.Namespace)()
    glog.V(3).Infof("handle unbind pod %s", pod.Name)
    //计算浮动IP的key形如：dp_default_double-interface-deployment_double-interface-deployment-698d96ff8b-smnh7
    keyObj, err := util.FormatKey(pod)
    if err != nil {
        return err
    }
    key := keyObj.KeyInDB
    //对接第三方公有云的grpc server
    if p.cloudProvider != nil {
        ipInfos, err := p.ipam.ByKeyAndIPRanges(key, nil)
        if err != nil {
            return fmt.Errorf("query floating ip by key %s: %v", key, err)
        }
        for _, ipInfo := range ipInfos {
            ipStr := ipInfo.IPInfo.IP.IP.String()
            glog.Infof("UnAssignIP nodeName %s, ip %s, key %s", ipInfo.NodeName, ipStr, key)
            if err = p.cloudProviderUnAssignIP(&rpc.UnAssignIPRequest{
                NodeName:  ipInfo.NodeName,
                IPAddress: ipStr,
            }); err != nil {
                return fmt.Errorf("failed to unassign ip %s from %s: %v", ipStr, key, err)
            }
        }
    }
    //解析ip释放策略，优先级区分
    //1.如果配置了浮动IP池的annotation，ip释放策略为never
    //2.如果配置了浮动IP的annotation，ip释放策略为该配置的策略
    //3.上述都没匹配到的话，即为默认策略，尽可能快释放ip
    policy := parseReleasePolicy(&pod.ObjectMeta)
    if keyObj.Deployment() {
        //deployment类型
        //根据不同浮动ip释放策略区分
        //1.默认策略，即释放ip
        //2.never策略，即保留ip，举例deployment类型，更新浮动ip cr的key为dp_default_double-interface-deployment_
        //3.immutable策略，即删除pod或scale down过程释放ip
        return p.unbindDpPod(keyObj, policy, "during unbinding pod")
    }
    //非deployment类型
    //也是根据不同浮动ip释放策略区分
    return p.unbindNoneDpPod(keyObj, policy, "during unbinding pod")
}
```

galaxy-ipam复用原来的ip在调度filter阶段，在filter阶段完成浮动ip key的更新，例如把key从`dp_default_double-interface-deployment`_更新为`dp_default_double-interface-deployment_double-interface-deployment-698d96ff8b-ns7gv`，然后再在bind阶段完成ip信息写到pod的annotation.

```go
//filter阶段最终会调用到allocateDuringFilter函数
func (p *FloatingIPPlugin) Filter ->  p.getSubnet(pod) -> p.allocateDuringFilter(keyObj, reserve, isPoolSizeDefined, reserveSubnet, policy, string(pod.UID))
```

```go
func (p *FloatingIPPlugin) allocateDuringFilter(keyObj *util.KeyObj, reserve, isPoolSizeDefined bool,
    reserveSubnet string, policy constant.ReleasePolicy, uid string) error {
    // we can't get nodename during filter, update attr on bind
    attr := floatingip.Attr{Policy: policy, NodeName: "", Uid: uid}
    if reserve {
        //浮动ip释放策略为never的话，reserve为true
        if err := p.allocateInSubnetWithKey(keyObj.PoolPrefix(), keyObj.KeyInDB, reserveSubnet, attr,
            "filter"); err != nil {
            return err
        }
    } else if isPoolSizeDefined {
        // if pool size defined and we got no reserved IP, we need to allocate IP from empty key
        _, ipNet, err := net.ParseCIDR(reserveSubnet)
        if err != nil {
            return err
        }
        if err := p.allocateInSubnet(keyObj.KeyInDB, ipNet, attr, "filter"); err != nil {
            return err
        }
    }
    return nil
}

func (p *FloatingIPPlugin) allocateInSubnetWithKey(oldK, newK, subnet string, attr floatingip.Attr, when string) error {
    //获取最近更新时间的浮动IP，也就是UpdatedAt时间最大的，并完成key的更新
    if err := p.ipam.AllocateInSubnetWithKey(oldK, newK, subnet, attr); err != nil {
        return err
    }
    //获取第一个匹配到的ip
    fip, err := p.ipam.First(newK)
    if err != nil {
        return err
    }
    glog.Infof("allocated ip %s to %s from %s during %s", fip.IPInfo.IP.String(), newK, oldK, when)
    return nil
}
```



### galaxy yaml sample

这里是一个使用k8s ipvlan模式的配置，ipvlan支持需要内核4.2以上

#### galayx yaml
```
# vim galaxy-v1.0.6.yaml
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  labels:
    app: galaxy
  name: galaxy-daemonset
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: galaxy
  template:
    metadata:
      labels:
        app: galaxy
    spec:
      serviceAccountName: galaxy
      hostNetwork: true
      hostPID: true
      containers:
      - image: tkestack/galaxy:v1.0.6.fix-ipvlan
        command: ["/bin/sh"]
      # qcloud galaxy should run with --route-eni
        args: ["-c", "cp -p /etc/galaxy/cni/00-galaxy.conf /etc/cni/net.d/; cp -p /opt/cni/galaxy/bin/galaxy-sdn /opt/cni/galaxy/bin/loopback /opt/cni/bin/; /usr/bin/galaxy --logtostderr=true --v=3 --network-policy"]
      # private-cloud should run without --route-eni
      # args: ["-c", "cp -p /etc/galaxy/cni/00-galaxy.conf /etc/cni/net.d/; cp -p /opt/cni/galaxy/bin/galaxy-sdn /opt/cni/galaxy/bin/loopback /opt/cni/bin/; /usr/bin/galaxy --logtostderr=true --v=3"]
        imagePullPolicy: IfNotPresent
        env:
          - name: MY_NODE_NAME
            valueFrom:
              fieldRef:
                fieldPath: spec.nodeName
          - name: DOCKER_HOST
            value: unix:///host/run/docker.sock
        name: galaxy
        resources:
          requests:
            cpu: 100m
            memory: 200Mi
        securityContext:
          privileged: true
        volumeMounts:
        - name: galaxy-run
          mountPath: /var/run/galaxy/
        - name: flannel-run
          mountPath: /run/flannel
        - name: galaxy-log
          mountPath: /data/galaxy/logs
        - name: galaxy-etc
          mountPath: /etc/galaxy
        - name: cni-config
          mountPath: /etc/cni/net.d/
        - name: cni-bin
          mountPath: /opt/cni/bin
        - name: cni-etc
          mountPath: /etc/galaxy/cni
        - name: cni-state
          mountPath: /var/lib/cni
        - name: docker-sock
          mountPath: /host/run/
      terminationGracePeriodSeconds: 30
      tolerations:
      - effect: NoSchedule
        operator: Exists
      volumes:
      - name: galaxy-run
        hostPath:
          path: /var/run/galaxy
      - name: flannel-run
        hostPath:
          path: /run/flannel
      - name: galaxy-log
        emptyDir: {}
      - configMap:
          defaultMode: 420
          name: galaxy-etc
        name: galaxy-etc
      - name: cni-config
        hostPath:
          path: /etc/cni/net.d/
      - name: cni-bin
        hostPath:
          path: /opt/cni/bin
      - name: cni-state
        hostPath:
          path: /var/lib/cni
      - configMap:
          defaultMode: 420
          name: cni-etc
        name: cni-etc
      - name: docker-sock
        # in case of docker restart, /run/docker.sock may change, we have to mount the /run directory
        hostPath:
          path: /run/
```

DefaultNetworks使用galaxy-k8s-vlan
```
# kubectl -n kube-system edit cm galaxy-etc
  galaxy.json: |
    {
      "NetworkConf":[
        {"name":"tke-route-eni","type":"tke-route-eni","eni":"eth1","routeTable":1},
        {"name":"galaxy-flannel","type":"galaxy-flannel", "delegate":{"type":"galaxy-veth"},"subnetFile":"/run/flannel/subnet.env"},
        {"name":"galaxy-k8s-vlan","type":"galaxy-k8s-vlan", "device":"eth0", "switch":"ipvlan", "ipvlan_mode":"l2"},
        {"name":"galaxy-k8s-sriov","type": "galaxy-k8s-sriov", "device": "eth0", "vf_num": 10}
      ],
      "DefaultNetworks": ["galaxy-k8s-vlan"]
    }
```

#### galaxy-ipam yaml
```
# vim galaxy-ipam-v1.0.6.yaml
apiVersion: v1
kind: Service
metadata:
  name: galaxy-ipam
  namespace: kube-system
  labels:
    app: galaxy-ipam
spec:
  type: NodePort
  ports:
  - name: scheduler-port
    port: 9040
    targetPort: 9040
    nodePort: 32760
    protocol: TCP
  - name: api-port
    port: 9041
    targetPort: 9041
    nodePort: 32761
    protocol: TCP
  selector:
    app: galaxy-ipam
---
apiVersion: rbac.authorization.k8s.io/v1
# kubernetes versions before 1.8.0 should use rbac.authorization.k8s.io/v1beta1
kind: ClusterRole
metadata:
  name: galaxy-ipam
rules:
- apiGroups: [""]
  resources:
  - pods
  - namespaces
  - nodes
  - pods/binding
  verbs: ["list", "watch", "get", "patch", "create"]
- apiGroups: ["apps", "extensions"]
  resources:
  - statefulsets
  - deployments
  verbs: ["list", "watch"]
- apiGroups: [""]
  resources:
  - configmaps
  - endpoints
  - events
  verbs: ["get", "list", "watch", "update", "create", "patch"]
- apiGroups: ["galaxy.k8s.io"]
  resources:
  - pools
  - floatingips
  verbs: ["get", "list", "watch", "update", "create", "patch", "delete"]
- apiGroups: ["apiextensions.k8s.io"]
  resources:
  - customresourcedefinitions
  verbs:
  - "*"
- apiGroups: ["apps.tkestack.io"]
  resources:
  - tapps
  verbs: ["list", "watch"]
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: galaxy-ipam
  namespace: kube-system
---
apiVersion: rbac.authorization.k8s.io/v1
# kubernetes versions before 1.8.0 should use rbac.authorization.k8s.io/v1beta1
kind: ClusterRoleBinding
metadata:
  name: galaxy-ipam
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: galaxy-ipam
subjects:
  - kind: ServiceAccount
    name: galaxy-ipam
    namespace: kube-system
---
apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app: galaxy-ipam
  name: galaxy-ipam
  namespace: kube-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: galaxy-ipam
  template:
    metadata:
      labels:
        app: galaxy-ipam
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
              - key: app
                operator: In
                values:
                - galaxy-ipam
            topologyKey: "kubernetes.io/hostname"
      serviceAccountName: galaxy-ipam
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      containers:
      - image: tkestack/galaxy-ipam:v1.0.6
        args:
          - --logtostderr=true
          - --profiling
          - --v=3
          - --config=/etc/galaxy/galaxy-ipam.json
          - --port=9040
          - --api-port=9041
          - --leader-elect
        command:
          - /usr/bin/galaxy-ipam
        ports:
          - containerPort: 9040
          - containerPort: 9041
        imagePullPolicy: Always
        name: galaxy-ipam
        resources:
          requests:
            cpu: 100m
            memory: 200Mi
        volumeMounts:
        - name: kube-config
          mountPath: /etc/kubernetes/
        - name: galaxy-ipam-log
          mountPath: /data/galaxy-ipam/logs
        - name: galaxy-ipam-etc
          mountPath: /etc/galaxy
      terminationGracePeriodSeconds: 30
      tolerations:
        - effect: NoSchedule
          key: node-role.kubernetes.io/master
          operator: Exists
      volumes:
      - name: kube-config
        hostPath:
          path: /etc/kubernetes/
      - name: galaxy-ipam-log
        emptyDir: {}
      - configMap:
          defaultMode: 420
          name: galaxy-ipam-etc
        name: galaxy-ipam-etc
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: galaxy-ipam-etc
  namespace: kube-system
data:
  # delete cloudProviderGrpcAddr if not ENI
  galaxy-ipam.json: |
    {
      "schedule_plugin": {
      }
    }
```

#### scheduler policy config

```
# cp /etc/kubernetes/{scheduler-policy-config.json,scheduler-policy-config.json.bak}
```

编辑scheduler policy配置
```
# vim /etc/kubernetes/scheduler-policy-config.json
{
  "kind": "Policy",
  "apiVersion": "v1",
  "extenders": [
    {
      "urlPrefix": "http://127.0.0.1:32760/v1",
      "httpTimeout": 10000000000,
      "filterVerb": "filter",
      "bindVerb": "bind",
      "weight": 1,
      "enableHttps": false,
      "managedResources": [
        {
          "name": "tke.cloud.tencent.com/eni-ip",
          "ignoredByScheduler": true
        }
      ]
    }
  ]
}
```

### 场景

#### 浮动IP池

```
cat <<EOF | kubectl create -f -
kind: ConfigMap
apiVersion: v1
metadata:
 name: floatingip-config
 namespace: kube-system
data:
 floatingips: '[{"nodeSubnets":["192.168.104.0/24"],"ips":["192.168.104.130~192.168.104.180"],"subnet":"192.168.104.0/24","gateway":"192.168.104.254"}]'
EOF
```
配置节点所在的网络，pod要使用的网络, 所有节点对应的neutron port需要设置对应的allow_address_pairs: 192.168.104.0/24; 放行这个网段；ips设置多个地址范围


配置多个subnet cidr
```
# kubectl -n kube-system edit cm floatingip-config
floatingips: '[{"nodeSubnets":["192.168.104.0/24"],"ips":["192.168.99.130~192.168.99.131"],"subnet":"192.168.99.0/24","gateway":"192.168.99.254"},
{"nodeSubnets":["192.168.104.0/24"],"ips":["192.168.100.130~192.168.100.180"],"subnet":"192.168.100.0/24","gateway":"192.168.100.254"}]'
```


#### 多网卡

deployment多网卡写法
```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: double-interface-deployment
  labels:
    app: web
spec:
  selector:
    matchLabels:
      app: web
  replicas: 2
  strategy:
    type: RollingUpdate
  template:
    metadata:
      labels:
        app: web
      annotations:
        k8s.v1.cni.cncf.io/networks: "galaxy-flannel,galaxy-k8s-vlan"
    spec:
      containers:
        - name: nginx
          image: nginx
          ports:
            - containerPort: 80
          resources:
            requests:
              tke.cloud.tencent.com/eni-ip: "1"
            limits:
              tke.cloud.tencent.com/eni-ip: "1"
```

pod多网卡写法
```
apiVersion: v1
kind: Pod
metadata:
  name: double-interface-pod
  annotations:
    k8s.v1.cni.cncf.io/networks: "galaxy-flannel,galaxy-k8s-vlan"
spec:
  containers:
    - name: nginx
      image: nginx
      resources:
        requests:
          tke.cloud.tencent.com/eni-ip: "1"
        limits:
          tke.cloud.tencent.com/eni-ip: "1"
```

#### 固定IP

对deployment、statefulset类型都生效
```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: double-interface-deployment
  labels:
    app: web
spec:
  selector:
    matchLabels:
      app: web
  replicas: 2
  strategy:
    type: RollingUpdate
  template:
    metadata:
      labels:
        app: web
      annotations:
        k8s.v1.cni.galaxy.io/release-policy: "never"
        k8s.v1.cni.cncf.io/networks: "galaxy-k8s-vlan,galaxy-flannel"
    spec:
      containers:
        - name: nginx
          image: nginx
          ports:
            - containerPort: 80
          resources:
            requests:
              bke.cloud.linklogis.com/eni-ip: "1"
            limits:
              bke.cloud.linklogis.com/eni-ip: "1"
```
- `k8s.v1.cni.galaxy.io/release-policy: never`: 不释放IP
- `k8s.v1.cni.galaxy.io/release-policy: immutable`: 在删除或scale down的情况下才释放IP


#### 测试

```
[root@localhost ~]# cat common-nginx.yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: common-nginx
  labels:
    app: common-nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: common-nginx
  template:
    metadata:
      name: common-nginx
      labels:
        app: common-nginx
      annotations:
        k8s.v1.cni.cncf.io/networks: "galaxy-k8s-vlan"
    spec:
      containers:
      - name: nginx
        image: registry.xxx.com/library/nginx
        resources:
          requests:
            tke.cloud.tencent.com/eni-ip: "1"
          limits:
            tke.cloud.tencent.com/eni-ip: "1"
```

```
[root@localhost ~]# kubectl get pod -o wide
NAME                 READY   STATUS    RESTARTS   AGE   IP                NODE              NOMINATED NODE   READINESS GATES
common-nginx-c7d8f   1/1     Running   0          68m   192.168.104.131   192.168.104.111   <none>           <none>
common-nginx-ftpcf   1/1     Running   0          68m   192.168.104.153   192.168.104.128   <none>           <none>
common-nginx-gk8ss   1/1     Running   0          68m   192.168.104.158   192.168.104.111   <none>           <none>
common-nginx-lwh2p   1/1     Running   0          68m   192.168.104.130   192.168.104.111   <none>           <none>
common-nginx-q8mq8   1/1     Running   0          68m   192.168.104.133   192.168.104.111   <none>           <none>
common-nginx-z85cj   1/1     Running   0          68m   192.168.104.142   192.168.104.111   <none>           <none>

[root@localhost ~]# kubectl get floatingips.galaxy.k8s.io
NAME              AGE
192.168.104.130   68m
192.168.104.131   68m
192.168.104.133   68m
192.168.104.142   68m
192.168.104.153   68m
192.168.104.158   68m
```

进入ip为192.168.104.153的pod的namespace，能够ping通网关
```
[root@localhost ~]# e common-nginx-ftpcf default
entering pod netns for default/common-nginx-ftpcf
nsenter -n --target 27501
[root@localhost ~]# ip a
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
8: eth0@if2: <BROADCAST,MULTICAST,NOARP,UP,LOWER_UP> mtu 1500 qdisc noqueue state UNKNOWN group default
    link/ether fa:16:3e:5e:b8:71 brd ff:ff:ff:ff:ff:ff
    inet 192.168.104.153/24 brd 192.168.104.255 scope global eth0
       valid_lft forever preferred_lft forever
[root@localhost ~]#
[root@localhost ~]# route -n
Kernel IP routing table
Destination     Gateway         Genmask         Flags Metric Ref    Use Iface
0.0.0.0         192.168.104.254 0.0.0.0         UG    0      0        0 eth0
192.168.104.0   0.0.0.0         255.255.255.0   U     0      0        0 eth0
```
外部能够通过<pod-ip>，直接访问其服务

### 参考链接

- [https://github.com/tkestack/galaxy](https://github.com/tkestack/galaxy)