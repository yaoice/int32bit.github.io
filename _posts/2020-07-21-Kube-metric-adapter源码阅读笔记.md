---
layout: post
title: K8s HPA
subtitle: kube-metric-adapter源码阅读笔记
catalog: true
tags:
     - k8s
---

### kube-metrics-adapter简介

Kube Metrics Adapter是Kubernetes的通用指标适配器，可以收集和提供用于水平Pod自动缩放的自定义指标和外部指标。

它支持基于[Prometheus度量标准](https://prometheus.io/)，[SQS队列](https://aws.amazon.com/sqs/)和其他现成的扩展。

它会发现Horizo​​ntal Pod Autoscaling资源，并开始收集请求的指标并将其存储在内存中。它是使用custom-metrics-apiserver库实现的。

### sample示例

这是一个Horizo​​ntalPodAutoscaler资源的示例，该资源配置为从部署myapp的每个pod中获取每秒请求数。
```
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
  annotations:
    # metric-config.<metricType>.<metricName>.<collectorName>/<configKey>
    metric-config.pods.requests-per-second.json-path/json-key: "$.http_server.rps"
    metric-config.pods.requests-per-second.json-path/path: /metrics
    metric-config.pods.requests-per-second.json-path/port: "9090"
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  minReplicas: 1
  maxReplicas: 10
  metrics:
  - type: Pods
    pods:
      metric:
        name: requests-per-second
      target:
        averageValue: 1k
        type: AverageValue
```
autoscaling/v2beta2 api在k8s 1.12+版本中可用

### Collectors

收集器是用于获取HPA资源请求的指标的不同实现。它们基于HPA资源进行配置，并由kube-metrics-adapter按需启动，以仅收集扩展应用程序所需的度量。

可以仅基于HPA资源中定义的指标来配置收集器，也可以通过HPA资源上的其他注释来配置收集器。

#### Prometheus collector

这里只分析Prometheus collector, 它与k8s-prometheus-adapter的区别在前面的文章介绍过了；

支持的metrics有:

| Metric | Description | Type | Kind | K8s Versions |
| ------------ | -------------- | ------- | -- | -- |
| `prometheus-query` | Generic metric which requires a user defined query. | External | | `>=1.12` |
| *custom* | No predefined metrics. Metrics are generated from user defined queries. | Object | *any* | `>=1.12` |

Object metric已废弃，未来会被淘汰.

### 源码分析

启动函数
```
func main() {
	logs.InitLogs()
	defer logs.FlushLogs()
    
	if len(os.Getenv("GOMAXPROCS")) == 0 {
		runtime.GOMAXPROCS(runtime.NumCPU())
	}

	cmd := server.NewCommandStartAdapterServer(wait.NeverStop)
	cmd.Flags().AddGoFlagSet(flag.CommandLine)
	if err := cmd.Execute(); err != nil {
		panic(err)
	}
}
```
1. 日志初始化
2. 设置Runtime Scheduler 中 Processor（简称P）的数量
3. 初始化cobra Command对象，设置RunE运行函数->RunCustomMetricsAdapterServer
4. 启动kube-metric-adapter api(custom-metrics-apiserver库实现)

NewCommandStartAdapterServer函数中比较重要的一个步骤，初始化AdapterServerOptions对象
```
    // 初始化CustomMetricsAdapterServerOptions对象, 涉及安全监听、认证、授权、特性启动
    baseOpts := server.NewCustomMetricsAdapterServerOptions()
    // 默认启动CustomMetricsAPI和ExternalMetricsAPI
	o := AdapterServerOptions{
		CustomMetricsAdapterServerOptions: baseOpts,
		EnableCustomMetricsAPI:            true,
		EnableExternalMetricsAPI:          true,
		MetricsAddress:                    ":7979",
		ZMONTokenName:                     "zmon",
		CredentialsDir:                    "/meta/credentials",
	}
```

AdapterServerOptions结构体
```
type AdapterServerOptions struct {
	*server.CustomMetricsAdapterServerOptions

	// RemoteKubeConfigFile is the config used to list pods from the master API server
	RemoteKubeConfigFile string
	// EnableCustomMetricsAPI switches on sample apiserver for Custom Metrics API
	EnableCustomMetricsAPI bool
	// EnableExternalMetricsAPI switches on sample apiserver for External Metrics API
	EnableExternalMetricsAPI bool
	// PrometheusServer enables prometheus queries to the specified
	// server
	PrometheusServer string
	// InfluxDBAddress enables Flux queries to the specified InfluxDB instance
	InfluxDBAddress string
	// InfluxDBToken is the token used for querying InfluxDB
	InfluxDBToken string
	// InfluxDBOrg is the organization ID used for querying InfluxDB
	InfluxDBOrg string
	// ZMONKariosDBEndpoint enables ZMON check queries to the specified
	// kariosDB endpoint
	ZMONKariosDBEndpoint string
	// ZMONTokenName is the name of the token used to query ZMON
	ZMONTokenName string
	// Token is an oauth2 token used to authenticate with services like
	// ZMON.
	Token string
	// CredentialsDir is the path to the dir where tokens are stored
	CredentialsDir string
	// SkipperIngressMetrics switches on support for skipper ingress based
	// metric collection.
	SkipperIngressMetrics bool
	// AWSExternalMetrics switches on support for getting external metrics
	// from AWS.
	AWSExternalMetrics bool
	// AWSRegions the AWS regions which are supported for monitoring.
	AWSRegions []string
	// MetricsAddress is the address where to serve prometheus metrics.
	MetricsAddress string
	// SkipperBackendWeightAnnotation is the annotation on the ingress indicating the backend weights
	SkipperBackendWeightAnnotation []string
	// Whether to disregard failing to create collectors for incompatible HPAs - such as when using
	// kube-metrics-adapter beside another Metrics Provider
	DisregardIncompatibleHPAs bool
}
```

执行Command对象中的RunE
```
func (o AdapterServerOptions) RunCustomMetricsAdapterServer(stopCh <-chan struct{}) error {
    // 暴露metrics给prometheus
	go func() {
		http.Handle("/metrics", promhttp.Handler())
		klog.Fatal(http.ListenAndServe(o.MetricsAddress, nil))
	}()
    // 构造apiserver的config
	config, err := o.Config()
	if err != nil {
		return err
	}
    // 构造获取clientSet的clientConfig
	var clientConfig *rest.Config
	if len(o.RemoteKubeConfigFile) > 0 {
        // 集群外访问
		loadingRules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: o.RemoteKubeConfigFile}
		loader := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, &clientcmd.ConfigOverrides{})

		clientConfig, err = loader.ClientConfig()
	} else {
        // 集群内访问
		clientConfig, err = rest.InClusterConfig()
	}
	if err != nil {
		return fmt.Errorf("unable to construct lister client config to initialize provider: %v", err)
	}

	// convert stop channel to a context
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-stopCh
		cancel()
	}()
    // 设置clientSet超时时间
	clientConfig.Timeout = defaultClientGOTimeout

	client, err := kubernetes.NewForConfig(clientConfig)
	if err != nil {
		return fmt.Errorf("failed to initialize new client: %v", err)
	}
    // 获取一个collector工厂对象
	collectorFactory := collector.NewCollectorFactory()

    // 注册prometheus collector
	if o.PrometheusServer != "" {
		promPlugin, err := collector.NewPrometheusCollectorPlugin(client, o.PrometheusServer)
		if err != nil {
			return fmt.Errorf("failed to initialize prometheus collector plugin: %v", err)
		}

		err = collectorFactory.RegisterObjectCollector("", "prometheus", promPlugin)
		if err != nil {
			return fmt.Errorf("failed to register prometheus object collector plugin: %v", err)
		}

		collectorFactory.RegisterExternalCollector([]string{collector.PrometheusMetricName}, promPlugin)
        
        // 注册Skipper collector
		// skipper collector can only be enabled if prometheus is.
		if o.SkipperIngressMetrics {
			skipperPlugin, err := collector.NewSkipperCollectorPlugin(client, promPlugin, o.SkipperBackendWeightAnnotation)
			if err != nil {
				return fmt.Errorf("failed to initialize skipper collector plugin: %v", err)
			}

			err = collectorFactory.RegisterObjectCollector("Ingress", "", skipperPlugin)
			if err != nil {
				return fmt.Errorf("failed to register skipper collector plugin: %v", err)
			}
		}
	}
    // 注册InfluxDB collector
	if o.InfluxDBAddress != "" {
		influxdbPlugin, err := collector.NewInfluxDBCollectorPlugin(client, o.InfluxDBAddress, o.InfluxDBToken, o.InfluxDBOrg)
		if err != nil {
			return fmt.Errorf("failed to initialize InfluxDB collector plugin: %v", err)
		}
		collectorFactory.RegisterExternalCollector([]string{collector.InfluxDBMetricName}, influxdbPlugin)
	}
    // 注册HTTP collector
	plugin, _ := collector.NewHTTPCollectorPlugin()
	collectorFactory.RegisterExternalCollector([]string{collector.HTTPMetricName}, plugin)
    // 注册pod collector
	// register generic pod collector
	err = collectorFactory.RegisterPodsCollector("", collector.NewPodCollectorPlugin(client))
	if err != nil {
		return fmt.Errorf("failed to register pod collector plugin: %v", err)
	}

    // 注册ZMON collector
	// enable ZMON based metrics
	if o.ZMONKariosDBEndpoint != "" {
		var tokenSource oauth2.TokenSource
		if o.Token != "" {
			tokenSource = oauth2.StaticTokenSource(&oauth2.Token{AccessToken: o.Token})
		} else {
			tokenSource = platformiam.NewTokenSource(o.ZMONTokenName, o.CredentialsDir)
		}

		httpClient := newOauth2HTTPClient(ctx, tokenSource)

		zmonClient := zmon.NewZMONClient(o.ZMONKariosDBEndpoint, httpClient)

		zmonPlugin, err := collector.NewZMONCollectorPlugin(zmonClient)
		if err != nil {
			return fmt.Errorf("failed to initialize ZMON collector plugin: %v", err)
		}

		collectorFactory.RegisterExternalCollector([]string{collector.ZMONCheckMetric}, zmonPlugin)
	}

	awsSessions := make(map[string]*session.Session, len(o.AWSRegions))
	for _, region := range o.AWSRegions {
		awsSessions[region], err = session.NewSession(&aws.Config{Region: aws.String(region)})
		if err != nil {
			return fmt.Errorf("unabled to create aws session for region: %s", region)
		}
	}
    // 注册aws collector
	if o.AWSExternalMetrics {
		collectorFactory.RegisterExternalCollector([]string{collector.AWSSQSQueueLengthMetric}, collector.NewAWSCollectorPlugin(awsSessions))
	}
    
    // 初始化provider对象, 实现了MetricsProvider接口(github.com/kubernetes-incubator/custom-metrics-apiserver库)
	hpaProvider := provider.NewHPAProvider(client, 30*time.Second, 1*time.Minute, collectorFactory, o.DisregardIncompatibleHPAs)
    // 运行HPA资源发现和metric收集
	go hpaProvider.Run(ctx)

	customMetricsProvider := hpaProvider
	externalMetricsProvider := hpaProvider

	// var externalMetricsProvider := nil
	if !o.EnableCustomMetricsAPI {
		customMetricsProvider = nil
	}
	if !o.EnableExternalMetricsAPI {
		externalMetricsProvider = nil
	}

	informer := informers.NewSharedInformerFactory(client, 0)
    // 封装得比较好，k8s聚合API方式启动
	// In this example, the same provider implements both Custom Metrics API and External Metrics API
	server, err := config.Complete(informer).New("kube-metrics-adapter", customMetricsProvider, externalMetricsProvider)
	if err != nil {
		return err
	}
	return server.GenericAPIServer.PrepareRun().Run(ctx.Done())
}
```

#### Collector工厂

CollectorFactory结构体定义
```
// collector分三种类型：pods、object、external
type CollectorFactory struct {
	podsPlugins     pluginMap
    // objectPluginMap的数据结构有点特殊，嵌套pluginMap，作用？
	objectPlugins   objectPluginMap
    // externalPlugins就一个map数据结构
	externalPlugins map[string]CollectorPlugin
}

type objectPluginMap struct {
	Any   pluginMap
	Named map[string]*pluginMap
}

type pluginMap struct {
	Any   CollectorPlugin
	Named map[string]CollectorPlugin
}

// 所有Collector插件都要实现CollectorPlugin接口定义的NewCollector方法，其返回的对象也要实现Collector接口定义的GetMetrics和Interval方法
type CollectorPlugin interface {
	NewCollector(hpa *autoscalingv2.HorizontalPodAutoscaler, config *MetricConfig, interval time.Duration) (Collector, error)
}

type Collector interface {
    // 获取metrics
	GetMetrics() ([]CollectedMetric, error)
    // 收集间隔
	Interval() time.Duration
}

type CollectedMetric struct {
    // autoscalingv2 metric源类型
    // 有Object、Pods、Resource、External, 代码里有注释说明
	Type     autoscalingv2.MetricSourceType
    // 自定义metric的值
	Custom   custom_metrics.MetricValue
    // 外部metric的值
	External external_metrics.ExternalMetricValue
}
```

Collector工厂函数，返回一个CollectorFactory对象
```
func NewCollectorFactory() *CollectorFactory {
	return &CollectorFactory{
        // pluginMap的Named是map数据结构，key是metricCollector的名称，形如prometheus、influxdb、json-path等
		podsPlugins: pluginMap{Named: map[string]CollectorPlugin{}},
		objectPlugins: objectPluginMap{
			Any:   pluginMap{},
            // map数据结构，key是Object的类型kind，形如Ingress等
			Named: map[string]*pluginMap{},
		},
        // externalPlugins也是map数据结构，key是metricName，形如prometheus-query
		externalPlugins: map[string]CollectorPlugin{},
	}
}
```

#### Prometheus Collector插件实现

Prometheus Collector插件的实现过程，其它插件类似的过程
```
+------------------------------------+            +------------------------------+
|                                    | 初始化对象   |                              |
|     NewPrometheusCollectorPlugin   +------------+ PrometheusCollectorPlugin对象 |
|                                    |            |                              |
+------------------------------------+            +-------------+----------------+
                                                                |
                                                                |
                                                                |实现了CollectorPlugin接口
                                                                |
                                                                |
                                                    +-----------+----------+
                                                    |                      |
                                                    |   NewCollector方法    |
                                                    |                      |
                                                    +-----------+----------+
                                                                |
                                                                |
                                                                |
                                                                |
                                                    +-----------+-------------+
                                                    |                         |
                                                    |  NewPrometheusCollector |
                                                    |                         |
                                                    +------------+------------+
                                                                 |
                                                                 |
                                                                 |初始化对象
                                                                 |
                                                     +-----------+------------+
                                                     |                        |
                                                     | PrometheusCollector对象 |
                                                     |                        |
                                                     +-----------+------------+
                                                                 |
                                                                 |
                                                                 |实现了Collector接口
                                                                 |
                                           +----------------+    |    +---------------+
                                           |                |    |    |               |
                                           | GetMetrics方法  +----+----+  Interval方法  |
                                           |                |         |               |
                                           +----------------+         +---------------+

```

具体代码分析
```
const (
	PrometheusMetricName          = "prometheus-query"
	prometheusQueryNameLabelKey   = "query-name"
	prometheusServerAnnotationKey = "prometheus-server"
)

// 自定义错误类型
type NoResultError struct {
	query string
}

func (r NoResultError) Error() string {
	return fmt.Sprintf("query '%s' did not result a valid response", r.query)
}

// PrometheusCollectorPlugin结构体定义
type PrometheusCollectorPlugin struct {
    // 与prometheus api交互
	promAPI promv1.API
    // 与k8s api交互(client-go库的clientSet对象)
	client  kubernetes.Interface
}

// 初始化PrometheusCollectorPlugin对象
func NewPrometheusCollectorPlugin(client kubernetes.Interface, prometheusServer string) (*PrometheusCollectorPlugin, error) {
	cfg := api.Config{
		Address:      prometheusServer,
		RoundTripper: http.DefaultTransport,
	}
    // 根据prometheus server地址，获取一个跟prometheus api交互的client对象
	promClient, err := api.NewClient(cfg)
	if err != nil {
		return nil, err
	}

	return &PrometheusCollectorPlugin{
		client:  client,
		promAPI: promv1.NewAPI(promClient),
	}, nil
}

// CollectorPlugin接口定义的方法
func (p *PrometheusCollectorPlugin) NewCollector(hpa *autoscalingv2.HorizontalPodAutoscaler, config *MetricConfig, interval time.Duration) (Collector, error) {
	return NewPrometheusCollector(p.client, p.promAPI, hpa, config, interval)
}

// 这里autoscaling使用的是v2beta2的API
type PrometheusCollector struct {
	client          kubernetes.Interface
	promAPI         promv1.API
	query           string
	metric          autoscalingv2.MetricIdentifier
	metricType      autoscalingv2.MetricSourceType
	objectReference custom_metrics.ObjectReference
	interval        time.Duration
	perReplica      bool
	hpa             *autoscalingv2.HorizontalPodAutoscaler
}

// metric-config.<metricType>.<metricName>.<collectorName>/<configKey>
// <configKey> == query-name
// External metric类型：metric-config.external.prometheus-query.prometheus/processed-events-per-second: |
//         scalar(sum(rate(event-service_events_count{application="event-service",processed="true"}[1m])))
// Object metric类型：metric-config.object.processed-events-per-second.prometheus/per-replica: "true"
func NewPrometheusCollector(client kubernetes.Interface, promAPI promv1.API, hpa *autoscalingv2.HorizontalPodAutoscaler, config *MetricConfig, interval time.Duration) (*PrometheusCollector, error) {
	c := &PrometheusCollector{
		client:     client,
		promAPI:    promAPI,
		interval:   interval,
		hpa:        hpa,
		metric:     config.Metric,
		metricType: config.Type,
	}

	switch config.Type {
    // Object metric类型
	case autoscalingv2.ObjectMetricSourceType:
		c.objectReference = config.ObjectReference
		c.perReplica = config.PerReplica

		if v, ok := config.Config["query"]; ok {
			// TODO: validate query
			c.query = v
		} else {
			return nil, fmt.Errorf("no prometheus query defined")
		}
    // External metric类型
	case autoscalingv2.ExternalMetricSourceType:
        // 必须设置Selector匹配labels
		if config.Metric.Selector == nil {
			return nil, fmt.Errorf("selector for prometheus query is not specified")
		}
        // 获取metric-config.<metricType>.<metricName>.<collectorName>/<configKey>格式中的configKey
		queryName, ok := config.Config[prometheusQueryNameLabelKey]
		if !ok {
			return nil, fmt.Errorf("query name not specified on metric")
		}
        // 根据configKey获取对应的值，也就是prom sql语句，形如scalar(sum(rate(event-service_events_count{application="event-service",processed="true"}[1m])))
		if v, ok := config.Config[queryName]; ok {
			// TODO: validate query
			c.query = v
		} else {
			return nil, fmt.Errorf("no prometheus query defined for metric")
		}
        // 可以为每个HPA对象设置独立的prometheus server url, 会覆盖全局配置的prometheus server
		// Use custom Prometheus URL if defined in HPA annotation.
		if promServer, ok := config.Config[prometheusServerAnnotationKey]; ok {
			cfg := api.Config{
				Address:      promServer,
				RoundTripper: http.DefaultTransport,
			}

			promClient, err := api.NewClient(cfg)
			if err != nil {
				return nil, err
			}
			c.promAPI = promv1.NewAPI(promClient)
		}
	}

	return c, nil
}

// Collector接口定义的方法
func (c *PrometheusCollector) GetMetrics() ([]CollectedMetric, error) {
    // 调用prometheus api查询
	// TODO: use real context
	value, _, err := c.promAPI.Query(context.Background(), c.query, time.Now().UTC())
	if err != nil {
		return nil, err
	}

	var sampleValue model.SampleValue
    // 查询返回的数据类型有：matrix、vector、scalar、string，对应的格式见这里：https://zhuanlan.zhihu.com/p/121104877
	switch value.Type() {
    // 根据不同的响应类型进行数据处理
	case model.ValVector:
		samples := value.(model.Vector)
		if len(samples) == 0 {
			return nil, &NoResultError{query: c.query}
		}

		sampleValue = samples[0].Value
	case model.ValScalar:
		scalar := value.(*model.Scalar)
		sampleValue = scalar.Value
	}
    // 判断NaN非数，一般用于表示无效的除法操作结果0/0或Sqrt(-1)
	if math.IsNaN(float64(sampleValue)) {
		return nil, &NoResultError{query: c.query}
	}

	if c.perReplica {
		// get current replicas for the targeted scale object. This is used to
		// calculate an average metric instead of total.
		// targetAverageValue will be available in Kubernetes v1.12
		// https://github.com/kubernetes/kubernetes/pull/64097
        // 获取当前Deployment/StatefulSet的副本数
		replicas, err := targetRefReplicas(c.client, c.hpa)
		if err != nil {
			return nil, err
		}
        // 除以副本数，算平均值
		sampleValue = model.SampleValue(float64(sampleValue) / float64(replicas))
	}

	var metricValue CollectedMetric
    // metric类型判断处理
	switch c.metricType {
	case autoscalingv2.ObjectMetricSourceType:
		metricValue = CollectedMetric{
			Type: c.metricType,
			Custom: custom_metrics.MetricValue{
				DescribedObject: c.objectReference,
				Metric:          custom_metrics.MetricIdentifier{Name: c.metric.Name, Selector: c.metric.Selector},
				Timestamp:       metav1.Time{Time: time.Now().UTC()},
				Value:           *resource.NewMilliQuantity(int64(sampleValue*1000), resource.DecimalSI),
			},
		}
	case autoscalingv2.ExternalMetricSourceType:
		metricValue = CollectedMetric{
			Type: c.metricType,
			External: external_metrics.ExternalMetricValue{
				MetricName:   c.metric.Name,
				MetricLabels: c.metric.Selector.MatchLabels,
				Timestamp:    metav1.Time{Time: time.Now().UTC()},
				Value:        *resource.NewMilliQuantity(int64(sampleValue*1000), resource.DecimalSI),
			},
		}
	}
    // 只有一个metric，返回竟然是一个slice？
	return []CollectedMetric{metricValue}, nil
}

// Collector接口定义的方法
func (c *PrometheusCollector) Interval() time.Duration {
	return c.interval
}
```

插件实现完后，还要注册到collectorFactory
```
// 写入CollectorFactory的objectPlugins.Any.Named map
err = collectorFactory.RegisterObjectCollector("", "prometheus", promPlugin)
		if err != nil {
			return fmt.Errorf("failed to register prometheus object collector plugin: %v", err)
		}
// 写入externalPlugins map
collectorFactory.RegisterExternalCollector([]string{collector.PrometheusMetricName}, promPlugin)
```

#### HPA Provider

成为一个HPA Provider，就要实现MetricsProvider的接口

MetricsProvider的接口定义
```
// CustomMetricInfo describes a metric for a particular
// fully-qualified group resource.
type CustomMetricInfo struct {
	GroupResource schema.GroupResource
	Namespaced    bool
	Metric        string
}

// ExternalMetricInfo describes a metric.
type ExternalMetricInfo struct {
	Metric string
}

// CustomMetricsProvider is a source of custom metrics
// which is able to supply a list of available metrics,
// as well as metric values themselves on demand.
//
// Note that group-resources are provided  as GroupResources,
// not GroupKinds.  This is to allow flexibility on the part
// of the implementor: implementors do not necessarily need
// to be aware of all existing kinds and their corresponding
// REST mappings in order to perform queries.
//
// For queries that use label selectors, it is up to the
// implementor to decide how to make use of the label selector --
// they may wish to query the main Kubernetes API server, or may
// wish to simply make use of stored information in their TSDB.
// CustomMetricsProvider接口
type CustomMetricsProvider interface {
	// GetMetricByName fetches a particular metric for a particular object.
	// The namespace will be empty if the metric is root-scoped.
	GetMetricByName(name types.NamespacedName, info CustomMetricInfo, metricSelector labels.Selector) (*custom_metrics.MetricValue, error)

	// GetMetricBySelector fetches a particular metric for a set of objects matching
	// the given label selector.  The namespace will be empty if the metric is root-scoped.
	GetMetricBySelector(namespace string, selector labels.Selector, info CustomMetricInfo, metricSelector labels.Selector) (*custom_metrics.MetricValueList, error)

	// ListAllMetrics provides a list of all available metrics at
	// the current time.  Note that this is not allowed to return
	// an error, so it is reccomended that implementors cache and
	// periodically update this list, instead of querying every time.
	ListAllMetrics() []CustomMetricInfo
}

// ExternalMetricsProvider is a source of external metrics.
// Metric is normally identified by a name and a set of labels/tags. It is up to a specific
// implementation how to translate metricSelector to a filter for metric values.
// Namespace can be used by the implemetation for metric identification, access control or ignored.
// ExternalMetricsProvider接口
type ExternalMetricsProvider interface {
	GetExternalMetric(namespace string, metricSelector labels.Selector, info ExternalMetricInfo) (*external_metrics.ExternalMetricValueList, error)

	ListAllExternalMetrics() []ExternalMetricInfo
}

// MetricsProvider接口包含CustomMetricsProvider和ExternalMetricsProvider两个接口
type MetricsProvider interface {
	CustomMetricsProvider
	ExternalMetricsProvider
}
```

NewHPAProvider初始化HPAProvider对象
```
// metricCollection is a container for sending collected metrics across a
// channel.
type metricCollection struct {
	Values []collector.CollectedMetric
	Error  error
}

// NewHPAProvider initializes a new HPAProvider.
func NewHPAProvider(client kubernetes.Interface, interval, collectorInterval time.Duration, collectorFactory *collector.CollectorFactory, disregardIncompatibleHPAs bool) *HPAProvider {
    // channel中发送[]collector.CollectedMetric
	metricsc := make(chan metricCollection)
    // HPAProvider对象
	return &HPAProvider{
		client:            client,
		interval:          interval,
		collectorInterval: collectorInterval,
		metricSink:        metricsc,
		metricStore: NewMetricStore(func() time.Time {
            // 匿名函数，当前时间+15分钟的Time对象
			return time.Now().UTC().Add(15 * time.Minute)
		}),
		collectorFactory:          collectorFactory,
		recorder:                  recorder.CreateEventRecorder(client),
		logger:                    log.WithFields(log.Fields{"provider": "hpa"}),
		disregardIncompatibleHPAs: disregardIncompatibleHPAs,
	}
}
```
HPAProvider对象实现了MetricsProvider接口定义的所有方法，实际上是metricStore实现了上述方法，

```
// GetMetricByName gets a single metric by name.
func (p *HPAProvider) GetMetricByName(name types.NamespacedName, info provider.CustomMetricInfo, metricSelector labels.Selector) (*custom_metrics.MetricValue, error) {
	metric := p.metricStore.GetMetricsByName(name, info)
	if metric == nil {
		return nil, provider.NewMetricNotFoundForError(info.GroupResource, info.Metric, name.Name)
	}
	return metric, nil
}

// GetMetricBySelector returns metrics for namespaced resources by
// label selector.
func (p *HPAProvider) GetMetricBySelector(namespace string, selector labels.Selector, info provider.CustomMetricInfo, metricSelector labels.Selector) (*custom_metrics.MetricValueList, error) {
	return p.metricStore.GetMetricsBySelector(namespace, selector, info), nil
}

// ListAllMetrics list all available metrics from the provicer.
func (p *HPAProvider) ListAllMetrics() []provider.CustomMetricInfo {
	return p.metricStore.ListAllMetrics()
}

func (p *HPAProvider) GetExternalMetric(namespace string, metricSelector labels.Selector, info provider.ExternalMetricInfo) (*external_metrics.ExternalMetricValueList, error) {
	return p.metricStore.GetExternalMetric(namespace, metricSelector, info)
}

func (p *HPAProvider) ListAllExternalMetrics() []provider.ExternalMetricInfo {
	return p.metricStore.ListAllExternalMetrics()
}
```

NewMetricStore初始化MetricStore对象，用map数据结构来存储metric值
```
// customMetricsStoredMetric is a wrapper around custom_metrics.MetricValue with a metricsTTL used
// to clean up stale metrics from the customMetricsStore.
type customMetricsStoredMetric struct {
	Value custom_metrics.MetricValue
	TTL   time.Time
}

type externalMetricsStoredMetric struct {
	Value external_metrics.ExternalMetricValue
	TTL   time.Time
}

// MetricStore is a simple in-memory Metrics Store for HPA metrics.
type MetricStore struct {
	customMetricsStore   map[string]map[schema.GroupResource]map[string]map[string]customMetricsStoredMetric
	externalMetricsStore map[string]map[string]externalMetricsStoredMetric
	metricsTTLCalculator func() time.Time
	sync.RWMutex
}

// NewMetricStore initializes an empty Metrics Store.
func NewMetricStore(ttlCalculator func() time.Time) *MetricStore {
	return &MetricStore{
        // 4层map嵌套数据结构？
		customMetricsStore:   make(map[string]map[schema.GroupResource]map[string]map[string]customMetricsStoredMetric, 0),
		// 2层map嵌套数据结构
        externalMetricsStore: make(map[string]map[string]externalMetricsStoredMetric, 0),
		metricsTTLCalculator: ttlCalculator,
	}
}
```

核心部分，HPA资源发现和metric收集
```
// Run runs the HPA resource discovery and metric collection.
func (p *HPAProvider) Run(ctx context.Context) {
	// initialize collector table
    // 初始化CollectorScheduler对象
	p.collectorScheduler = NewCollectorScheduler(ctx, p.metricSink)
    // 从collector收集所有的metric, 写入metricStore
	go p.collectMetrics(ctx)

	for {
        // 解析集群中所有的HPA对象，根据HPA对象中的配置构建Collector
		err := p.updateHPAs()
		if err != nil {
			p.logger.Error(err)
			UpdateErrors.Inc()
		} else {
			UpdateSuccesses.Inc()
		}

		select {
        // 间隔30s
		case <-time.After(p.interval):
		case <-ctx.Done():
			p.logger.Info("Stopped HPA provider.")
			return
		}
	}
}

// NewCollectorScheudler initializes a new CollectorScheduler.
func NewCollectorScheduler(ctx context.Context, metricsc chan<- metricCollection) *CollectorScheduler {
	return &CollectorScheduler{
		ctx:        ctx,
		table:      map[resourceReference]map[collector.MetricTypeName]context.CancelFunc{},
		metricSink: metricsc,
	}
}

// CollectorScheduler is a scheduler for running metric collection jobs.
// It keeps track of all running collectors and stops them if they are to be
// removed.
type CollectorScheduler struct {
	ctx        context.Context
    // hap资源与metric指标的映射关系；第一层map数据结构，key是hap资源，value是第二层map，存放metric与ctx的自定义CancelFunc
	table      map[resourceReference]map[collector.MetricTypeName]context.CancelFunc
	metricSink chan<- metricCollection
	sync.RWMutex
}
```

从collector收集所有的metric
```
// collectMetrics collects all metrics from collectors and manages a central
// metric store.
func (p *HPAProvider) collectMetrics(ctx context.Context) {
	// run garbage collection every 10 minutes
	go func(ctx context.Context) {
		for {
			select {
			case <-time.After(10 * time.Minute):
                // 间隔10分钟，移除MetricStore中customMetricsStore/externalMetricsStore中ttl过期的metric(ttl时间15分钟)
				p.metricStore.RemoveExpired()
			case <-ctx.Done():
				p.logger.Info("Stopped metrics store garbage collection.")
				return
			}
		}
	}(ctx)

	for {
		select {
        // 从metricSink channel中取值
		case collection := <-p.metricSink:
			if collection.Error != nil {
				p.logger.Errorf("Failed to collect metrics: %v", collection.Error)
				CollectionErrors.Inc()
			} else {
				CollectionSuccesses.Inc()
			}

			p.logger.Infof("Collected %d new metric(s)", len(collection.Values))
            // 根据CollectedMetric的类型来处理
			for _, value := range collection.Values {
				switch value.Type {
				case autoscalingv2.ObjectMetricSourceType, autoscalingv2.PodsMetricSourceType:
					p.logger.Infof("Collected new custom metric '%s' (%s) for %s %s/%s",
						value.Custom.Metric.Name,
						value.Custom.Value.String(),
						value.Custom.DescribedObject.Kind,
						value.Custom.DescribedObject.Namespace,
						value.Custom.DescribedObject.Name,
					)
				case autoscalingv2.ExternalMetricSourceType:
					p.logger.Infof("Collected new external metric '%s' (%s) [%s]",
						value.External.MetricName,
						value.External.Value.String(),
						labels.Set(value.External.MetricLabels).String(),
					)
				}
                // metric是Object、Pods类型，写入customMetricsStore
                // metric是External类型，写入externalMetricsStore
				p.metricStore.Insert(value)
			}
		case <-ctx.Done():
			p.logger.Info("Stopped metrics collection.")
			return
		}
	}
}
```

// 解析HPA对象，构建Collector
```
// updateHPAs discovers all HPA resources and sets up metric collectors for new
// HPAs.
func (p *HPAProvider) updateHPAs() error {
	p.logger.Info("Looking for HPAs")
    // 获取集群所有的HPA对象(v2beta2 api)
	hpas, err := p.client.AutoscalingV2beta2().HorizontalPodAutoscalers(metav1.NamespaceAll).List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return err
	}
    // HPA map缓存
	newHPACache := make(map[resourceReference]autoscalingv2.HorizontalPodAutoscaler, len(hpas.Items))

	newHPAs := 0

	for _, hpa := range hpas.Items {
		resourceRef := resourceReference{
			Name:      hpa.Name,
			Namespace: hpa.Namespace,
		}
        // 先从缓存里获取
		cachedHPA, ok := p.hpaCache[resourceRef]
		hpaUpdated := !equalHPA(cachedHPA, hpa)
		if !ok || hpaUpdated {
			// if the hpa has changed then remove the previous
			// scheduled collector.
			if hpaUpdated {
				p.logger.Infof("Removing previously scheduled metrics collector: %s", resourceRef)
				p.collectorScheduler.Remove(resourceRef)
			}
            // 解析HPA对象里的以metric-config为前缀的annotation，返回[]*MetricConfig；可以设置两个特殊的annotation
            // metric-config.*.*.*/per-replica，会自动把metric值除以副本数
            // metric-config.*.*.*/interval，可设置局部的收集间隔，覆盖全局的metric收集间隔collectorInterval
			metricConfigs, err := collector.ParseHPAMetrics(&hpa)
			if err != nil {
				p.logger.Errorf("Failed to parse HPA metrics: %v", err)
				continue
			}

			cache := true
			for _, config := range metricConfigs {
				interval := config.Interval
				if interval == 0 {
					interval = p.collectorInterval
				}
                // 从collector工厂里，根据HPA里面定义的metricType调用对应的collector插件返回Collector对象
                // 这里以prometheus collector插件为例
				c, err := p.collectorFactory.NewCollector(&hpa, config, interval)
				if err != nil {

					// Only log when it's not a PluginNotFoundError AND flag disregardIncompatibleHPAs is true
					if !(errors.Is(err, &collector.PluginNotFoundError{}) && p.disregardIncompatibleHPAs) {
						p.recorder.Eventf(&hpa, apiv1.EventTypeWarning, "CreateNewMetricsCollector", "Failed to create new metrics collector: %v", err)
					}

					cache = false
					continue
				}

				p.logger.Infof("Adding new metrics collector: %T", c)
                // 添加collector到CollectorScheduler的table，重复添加的话就先停止旧的collector
                // 每隔上面collector间隔时间就调用collector插件实现的GetMetrics()获取指标值写入metricCollection channel                
				p.collectorScheduler.Add(resourceRef, config.MetricTypeName, c)
			}
			newHPAs++

			// if we get an error setting up the collectors for the
			// HPA, don't cache it, but try again later.
			if !cache {
				continue
			}
		}
        // 写入新的HPA Cache中
		newHPACache[resourceRef] = hpa
	}

	for ref := range p.hpaCache {
		if _, ok := newHPACache[ref]; ok {
			continue
		}

		p.logger.Infof("Removing previously scheduled metrics collector: %s", ref)
		p.collectorScheduler.Remove(ref)
	}

	p.logger.Infof("Found %d new/updated HPA(s)", newHPAs)
    // 更新缓存
	p.hpaCache = newHPACache
	return nil
}
```
一个HPA Provider的运行过程分析就是这样了

#### HPA Controller生成custom/external.metrics.k8s.io

HPA对象的指标转化为custom/external.metrics.k8s.io API可获取的指标；这部分工作是由kube-controller-manager的HPA controller实现的
```
HPA Controller -> Metrics Aggregator -> Kube-metric-adapter -> Prometheus
```
Horizo​​ntalPodAutoscaler通常从一系列聚合的API（metrics.k8s.io，custom.metrics.k8s.io和external.metrics.k8s.io）中获取指标.


### 参考链接

- [https://github.com/zalando-incubator/kube-metrics-adapter/blob/master/README.md](https://github.com/zalando-incubator/kube-metrics-adapter/blob/master/README.md)
- [https://github.com/kubernetes-sigs/custom-metrics-apiserver/blob/master/test-adapter/main.go](https://github.com/kubernetes-sigs/custom-metrics-apiserver/blob/master/test-adapter/main.go)
