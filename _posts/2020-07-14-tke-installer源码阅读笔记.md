---
layout: post
title: TKEStack
subtitle: tke-installer源码阅读笔记
catalog: true
tags:
     - tkestack
---

### 简介

通过tke-installer安装TKEStack，tke-install以docker方式运行，包含所有安装所需要的资源，并且提供web ui来引导部署.

### 架构

<img src="/img/posts/2020-07-14/TKEStackHighLevelArchitecture@2x.png"/>

[tke-installer安装](https://github.com/tkestack/tke/blob/master/docs/user/tke-installer/normal-installation.md)

### tke-installer编译

克隆tke仓库
```
git clone https://github.com/tkestack/tke.git
git checkout v1.3.0
```

tke-installer Dockerfile目录结构
```
$ tree -a build/docker/tools/tke-installer
build/docker/tools/tke-installer
├── .docker
│   └── config.json
├── Dockerfile
├── build.sh
├── certs
│   ├── server.crt
│   └── server.key
├── daemon.json
├── init_installer.sh
├── install.sh
└── release.sh
```

查看Makefile中的release部分
```
## release: Release tke
.PHONY: release
release:
	build/docker/tools/tke-installer/release.sh
```

脚本间的调用关系链
```
release.sh -----> build.sh --> init_installer.sh --> install.sh
           |
           |
           ----> Dockfile 
```

### tke-installer源码

入口函数
```
// cmd/tke-installer/installer.go
func main() {
	rand.Seed(time.Now().UTC().UnixNano())
	if len(os.Getenv("GOMAXPROCS")) == 0 {
		runtime.GOMAXPROCS(runtime.NumCPU())
	}

	app.NewApp("tke-installer").Run()
}

// Config结构体
// Config is the running configuration structure of the TKE controller manager.
type Config struct {
	ServerName                 string
	ListenAddr                 string
	NoUI                       bool
	Config                     string
	Force                      bool
	SyncProjectsWithNamespaces bool
	Replicas                   int
}

// 调用到此处的Run函数
// New的是一个TKE对象
// Run runs the specified TKE installer. This should never exit.
func Run(cfg *config.Config) error {
	installer.New(cfg).Run()

	return nil
}
```

TKE结构体
```
type TKE struct {
	Config  *config.Config           `json:"config"`
	Para    *types.CreateClusterPara `json:"para"`
	Cluster *v1.Cluster              `json:"cluster"`
	Step    int                      `json:"step"`
	// IncludeSelf means installer is using one of cluster's machines
	IncludeSelf bool `json:"includeSelf"`

	log             log.Logger
	steps           []types.Handler
	progress        *types.ClusterProgress
	strategy        *clusterstrategy.Strategy
	clusterProvider clusterprovider.Provider
	isFromRestore   bool

	docker *docker.Docker

	globalClient kubernetes.Interface
	servers      []string
	namespace    string
}
```

New函数，创建TKE对象
```
func New(config *config.Config) *TKE {
    // new一个TKE对象
	c := new(TKE)
    // 初始化参数
	c.Config = config
	c.Para = new(types.CreateClusterPara)
	c.Cluster = new(v1.Cluster)
	c.progress = new(types.ClusterProgress)
	c.progress.Status = types.StatusUnknown
    // baremental provider的init函数实现注册Baremetal provider
	clusterProvider, err := clusterprovider.GetProvider("Baremetal")
	if err != nil {
		panic(err)
	}
	c.clusterProvider = clusterProvider
    // 日志初始化
	_ = os.MkdirAll(path.Dir(constants.ClusterLogFile), 0755)
	logOptions := log.NewOptions()
	logOptions.DisableColor = true
	logOptions.OutputPaths = []string{constants.ClusterLogFile}
	logOptions.ErrorOutputPaths = logOptions.OutputPaths
	log.Init(logOptions)
	c.log = log.WithName("tke-installer")
    // 初始化docker客户端
	c.docker = new(docker.Docker)
	c.docker.Stdout = c.log
	c.docker.Stderr = c.log
    // 解析tke.json
	if !config.Force {
		data, err := ioutil.ReadFile(constants.ClusterFile)
		if err == nil {
			log.Infof("read %q success", constants.ClusterFile)
			err = json.Unmarshal(data, c)
			if err != nil {
				log.Warnf("load tke data error:%s", err)
			}
			log.Infof("load tke data success")
			c.isFromRestore = true
			c.progress.Status = types.StatusDoing
		}
	}

	return c
}
```

New完TKE对象，调用Run函数
```
func (t *TKE) Run() {
	var err error
    // 支持无UI方式
	if t.Config.NoUI {
		err = t.run()
    // 支持UI方式
	} else {
		err = t.runWithUI()
	}
	if err != nil {
		log.Error(err.Error())
	}
}

func (t *TKE) runWithUI() error {
    // 设置静态资源的接口路由
	a := NewAssertsResource()
	restful.Add(a.WebService())
    // 设置处理集群资源的接口路由
	restful.Add(t.WebService())
    // 设置处理SSH资源的接口路由, 测试ssh是否通畅
	s := NewSSHResource()
	restful.Add(s.WebService())
    // 类似middleware, 在分发请求到后端的webService前调用
    // globalLogging记录请求的时间
	restful.Filter(globalLogging)

	if t.isFromRestore {
        // isFromRestore为true, 调用do()
		go t.do()
	}
    // Server监听
	log.Infof("Starting %s at http://%s", t.Config.ServerName, t.Config.ListenAddr)
	return http.ListenAndServe(t.Config.ListenAddr, nil)
}

func (t *TKE) do() {
	start := time.Now()
	ctx := t.log.WithContext(context.Background())
    // 设置Registry地址和镜像仓库名, 可以为第三方镜像仓库或自带的
	containerregistry.Init(t.Para.Config.Registry.Domain(), t.Para.Config.Registry.Namespace())
    // 初始化部署阶段
	t.initSteps()
    // 准备开始进入部署
	if t.Step == 0 {
		t.log.Info("===>starting install task")
		t.progress.Status = types.StatusDoing
	}
    // 如果集群状态为Running的话
	if t.runAfterClusterReady() {
        // 初始化TKE对象的globalClient、servers、namespace变量
		t.initDataForDeployTKE()
	}
    // 遍历调用t.steps里面的Handler
	for t.Step < len(t.steps) {
        // Handler之间间隔10s
		wait.PollInfinite(10*time.Second, func() (bool, error) {
			t.log.Infof("%d.%s doing", t.Step, t.steps[t.Step].Name)
			start := time.Now()
			err := t.steps[t.Step].Func(ctx)
			if err != nil {
				t.progress.Status = types.StatusFailed
				t.log.Errorf("%d.%s [Failed] [%fs] error %s", t.Step, t.steps[t.Step].Name, time.Since(start).Seconds(), err)
				return false, nil
			}
			t.log.Infof("%d.%s [Success] [%fs]", t.Step, t.steps[t.Step].Name, time.Since(start).Seconds())

			t.Step++
            // 把集群配置写入到/opt/tke-installer/data/tke.json
			t.backup()

			return true, nil
		})
	}
    // 更新集群部署状态
	t.progress.Status = types.StatusSuccess
    // 赋值TKE对象的progress变量
	if t.Para.Config.Gateway != nil {
		var host string
		if t.Para.Config.Gateway.Domain != "" {
			host = t.Para.Config.Gateway.Domain
		} else if t.Para.Config.HA != nil {
			host = t.Para.Config.HA.VIP()
		} else {
			host = t.Para.Cluster.Spec.Machines[0].IP
		}
		t.progress.URL = fmt.Sprintf("http://%s", host)

		t.progress.Username = t.Para.Config.Basic.Username
		t.progress.Password = t.Para.Config.Basic.Password

		if t.Para.Config.Gateway.Cert.SelfSignedCert != nil {
			t.progress.CACert, _ = ioutil.ReadFile(constants.CACrtFile)
		}

		if t.Para.Config.Gateway.Domain != "" {
			t.progress.Hosts = append(t.progress.Hosts, t.Para.Config.Gateway.Domain)
		}

		cfg, _ := t.getKubeconfig()
		t.progress.Kubeconfig, _ = runtime.Encode(clientcmdlatest.Codec, cfg)
	}

	if t.Para.Config.Registry.TKERegistry != nil {
		t.progress.Hosts = append(t.progress.Hosts, t.Para.Config.Registry.TKERegistry.Domain)
	}

	t.progress.Servers = t.servers
	if t.Para.Config.HA != nil {
		t.progress.Servers = append(t.progress.Servers, t.Para.Config.HA.VIP())
	}
    // 部署完成
	t.log.Infof("===>install task [Sucesss] [%fs]", time.Since(start).Seconds())
}
```

初始化部署阶段
```
func (t *TKE) initSteps() {
    // 1. 在安装集群之前，是否触发hooks目录下的pre-install脚本
	t.steps = append(t.steps, []types.Handler{
		{
			Name: "Execute pre install hook",
			Func: t.preInstallHook,
		},
	}...)

	// UseDockerHub, no need load images, start local tcr and push images
	// TKERegistry load images && start local registry && push images to local registry
	// && deploy tke-registry-api && push images to tke-registry
	// ThirdPartyRegistry load images && push images
    // 2. 执行Load images(如果不用dockerHub), load镜像并修改tag
	if !t.Para.Config.Registry.IsOfficial() {
		t.steps = append(t.steps, []types.Handler{
			{
				Name: "Load images",
				Func: t.loadImages,
			},
		}...)
	}

	// if both set, don't setup local registry
    // 3. 运行本地的registry docker实例(如果使用TKE自带的registry), ，并把域名写入/etc/hosts
	if t.Para.Config.Registry.ThirdPartyRegistry == nil &&
		t.Para.Config.Registry.TKERegistry != nil {
		t.steps = append(t.steps, []types.Handler{
			{
				Name: "Setup local registry",
				Func: t.setupLocalRegistry,
			},
		}...)
	}
    // 4. Push images(如果不用dockerHub), push镜像/manifest到local registry
	if !t.Para.Config.Registry.IsOfficial() {
		t.steps = append(t.steps, []types.Handler{
			{
				Name: "Push images",
				Func: t.pushImages,
			},
		}...)
	}
        
	t.steps = append(t.steps, []types.Handler{
        // 5. 根据使用到的域名/IP为TKE组件产生证书(本地data/目录下)
		{
			Name: "Generate certificates for TKE components",
			Func: t.generateCertificates,
		},
        // 6. 创建global集群
		{
			Name: "Create global cluster",
			Func: t.createGlobalCluster,
		},
        // 7. 创建Kubeconfig(/root/.kube/config,data/admin.kubeconfig)
		{
			Name: "Write kubeconfig",
			Func: t.writeKubeconfig,
		},
        // 8. 集群Ready后，是否触发hooks目录下的post-cluster-ready脚本
		{
			Name: "Execute post deploy hook",
			Func: t.postClusterReadyHook,
		},
        // 9. 保存front-proxy-ca.crt到data/目录下
		{
			Name: "Prepare front proxy certificates",
			Func: t.prepareFrontProxyCertificates,
		},
        // 10. 创建tke k8s namespace
		{
			Name: "Create namespace for install TKE",
			Func: t.createNamespace,
		},
        // 11. 读取本地data/目录下的证书相关文件，还生成password.csv、token.csv，并把内容作为global集群上的certs configmap
		{
			Name: "Prepare certificates",
			Func: t.prepareCertificates,
		},
        // 12. 初始化providerConfig对象，
        //     修改registry ip, audit address，PlatformAPIClientConfig、AuthzWebhook endpoint变量，回写到provider/baremetal/conf/config.yaml
        //     并在global集群创建provider-config、docker、kubelet、kubeadm、gpu-manifests、gpu-manager-manifests、csi-operator-manifests、keepalived-manifests configmap
		{
			Name: "Prepare baremetal provider config",
			Func: t.prepareBaremetalProviderConfig,
		},
        // 13. 安装etcd
		{
			Name: "Install etcd",
			Func: t.installETCD,
		},
	}...)

	if t.Para.Config.Auth.TKEAuth != nil {
		t.steps = append(t.steps, []types.Handler{
            // 14. 部署tke-auth-api(如果用的是TKE认证)
			{
				Name: "Install tke-auth-api",
				Func: t.installTKEAuthAPI,
			}, 
            // 15. 部署tke-auth-controller(如果用的是TKE认证)
			{
				Name: "Install tke-auth-controller",
				Func: t.installTKEAuthController,
			},
		}...)
	}

	if t.auditEnabled() {
		t.steps = append(t.steps, []types.Handler{
            // 16. 部署tke audit，开启审计功能的话
			{
				Name: "Install tke audit",
				Func: t.installTKEAudit,
			},
		}...)
	}

	t.steps = append(t.steps, []types.Handler{
        // 17. 部署tke platform api
		{
			Name: "Install tke-platform-api",
			Func: t.installTKEPlatformAPI,
		},
        // 18. 部署tke platform controller
		{
			Name: "Install tke-platform-controller",
			Func: t.installTKEPlatformController,
		},
	}...)

	if t.Para.Config.Registry.TKERegistry != nil {
		t.steps = append(t.steps, []types.Handler{
            // 19. 部署tke registry api
			{
				Name: "Install tke-registry-api",
				Func: t.installTKERegistryAPI,
			},
		}...)
	}

	if t.Para.Config.Business != nil {
		t.steps = append(t.steps, []types.Handler{
            // 20. 部署tke business api
			{
				Name: "Install tke-business-api",
				Func: t.installTKEBusinessAPI,
			},
            // 21. 部署tke business controller
			{
				Name: "Install tke-business-controller",
				Func: t.installTKEBusinessController,
			},
		}...)
	}

	if t.Para.Config.Monitor != nil {
		if t.Para.Config.Monitor.InfluxDBMonitor != nil &&
			t.Para.Config.Monitor.InfluxDBMonitor.LocalInfluxDBMonitor != nil {
			t.steps = append(t.steps, []types.Handler{
                // 22. 部署influxdb
				{
					Name: "Install InfluxDB",
					Func: t.installInfluxDB,
				},
			}...)
		}
		t.steps = append(t.steps, []types.Handler{
            // 23. 部署tke monitor api
			{
				Name: "Install tke-monitor-api",
				Func: t.installTKEMonitorAPI,
			},
            // 24. 部署tke monitor controller
			{
				Name: "Install tke-monitor-controller",
				Func: t.installTKEMonitorController,
			},
            // 25. 部署tke notify api
			{
				Name: "Install tke-notify-api",
				Func: t.installTKENotifyAPI,
			},
            // 25. 部署tke notify controller
			{
				Name: "Install tke-notify-controller",
				Func: t.installTKENotifyController,
			},
		}...)
	}

	if t.Para.Config.Logagent != nil {
		t.steps = append(t.steps, []types.Handler{
            // 25. 部署tke logagent api
			{
				Name: "Install tke-logagent-api",
				Func: t.installTKELogagentAPI,
			},
            // 25. 部署tke logagent controller
			{
				Name: "Install tke-logagent-controller",
				Func: t.installTKELogagentController,
			},
		}...)
	}

	// others
    // 在此处添加其它组件

	// Add more tke component before THIS!!!
	if t.Para.Config.Gateway != nil {
        // tke-installer和global集群是否同台机器
		if t.IncludeSelf {
			t.steps = append(t.steps, []types.Handler{
                // 26. 运行的是tke-gateway pod, 这个pod会去拉镜像？
                // 监听这个pod的MODIFIED event, 然后删除这个pod
				{
					Name: "Prepare images before stop local registry",
					Func: t.prepareImages,
				},
                // 27. 移除registry-http, registry-https容器
				{
					Name: "Stop local registry to give up 80/443 for tke-gateway",
					Func: t.stopLocalRegistry,
				},
			}...)
		}
		t.steps = append(t.steps, []types.Handler{
            // 28. 部署tke-gateway
			{
				Name: "Install tke-gateway",
				Func: t.installTKEGateway,
			},
		}...)
	}

	t.steps = append(t.steps, []types.Handler{
        // 29. 注册TKE api到global集群
		{
			Name: "Register tke api into global cluster",
			Func: t.registerAPI,
		},
        // 30. 创建global集群的ClusterCredentials、Cluster资源(有点纳管global集群的味道)
		{
			Name: "Import resource to TKE platform",
			Func: t.importResource,
		},
	}...)

    // 没使用第三方仓库，且用的是tke自带的registry
	if t.Para.Config.Registry.ThirdPartyRegistry == nil &&
		t.Para.Config.Registry.TKERegistry != nil {
		t.steps = append(t.steps, []types.Handler{
            // 31. docker login到镜像仓库
			{
				Name: "Prepare push images to TKE registry",
				Func: t.preparePushImagesToTKERegistry,
			},
            // 32. push镜像到镜像仓库
			{
				Name: "Push images to registry",
				Func: t.pushImages,
			},
            // 33. 设置registry地址的静态主机解析，映射地址为global集群Machines字段的第一个节点
			{
				Name: "Set global cluster hosts",
				Func: t.setGlobalClusterHosts,
			},
		}...)
	}

	t.steps = append(t.steps, []types.Handler{
        // 34. 在安装集群之后，是否触发hooks目录下的post-install脚本
		{
			Name: "Execute post deploy hook",
			Func: t.postInstallHook,
		},
	}...)

    // 过滤steps, 可以定义SkipSteps，跳过特定步骤运行
	t.steps = funk.Filter(t.steps, func(step types.Handler) bool {
		return !funk.ContainsString(t.Para.Config.SkipSteps, step.Name)
	}).([]types.Handler)

	t.log.Info("Steps:")
	for i, step := range t.steps {
		t.log.Infof("%d %s", i, step.Name)
	}
}
```

#### 创建global集群的handler
```
func (t *TKE) createGlobalCluster(ctx context.Context) error {
    // registry的prefix和IP回写进provider/baremetal/conf/config.yaml
	// update provider config and recreate
	err := t.completeProviderConfigForRegistry()
	if err != nil {
		return err
	}
    // 初始化Baremetal provider对象，集群创建/修改/删除对应的Handlers都定义在此处
    // 设置registry的domain和namespace
    // 初始化provider对象的platformClient变量
	t.completeWithProvider()
    // 初始化credential
	if t.Cluster.Spec.ClusterCredentialRef == nil {
		credential := &platformv1.ClusterCredential{
			ObjectMeta: metav1.ObjectMeta{
				Name: fmt.Sprintf("cc-%s", t.Cluster.Name),
			},
			TenantID:    t.Cluster.Spec.TenantID,
			ClusterName: t.Cluster.Name,
		}
		t.Cluster.ClusterCredential = credential
		t.Cluster.Spec.ClusterCredentialRef = &corev1.LocalObjectReference{Name: credential.Name}
	}
    // 集群状态判断，是否为Initalizing
	for t.Cluster.Status.Phase == platformv1.ClusterInitializing {
        // 集群处于Initializing状态
		err := t.clusterProvider.OnCreate(ctx, t.Cluster)
		if err != nil {
			return err
		}
        // 把集群配置写入到/opt/tke-installer/data/tke.json
		t.backup()
	}
    // 初始化TKE对象的globalClient、servers、namespace变量
	err = t.initDataForDeployTKE()
	if err != nil {
		return fmt.Errorf("init data for deploy tke error: %w", err)
	}

	return nil
}
```

### 参考链接

- [https://github.com/tkestack/tke](https://github.com/tkestack/tke)