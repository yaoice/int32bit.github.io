---
layout: post
title: kong ingress controller实践
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

- Kubernetes v1.14.6
- Etcd 3.3.12
- Docker 18.09.9

### kong ingress controller简介

kong在API网关、API中间件和一些服务网格场景被我们所知，kong ingress controller，
它的任务就是watch k8s集群的ingress、service、endpoint、secret变化, 
动态生成kong的services、routes、consumers、plugins、upstreams、certificates.
从功能丰富度来看，可以取代nginx ingress controller.

### 安装kong ingress controller

采用k8s yaml方式，kong和kong ingress controller在同一个pod里
```
# vim ingress-kong/all-in-one-dbless.yaml 
---
apiVersion: v1
kind: Namespace
metadata:
  name: kong
---
apiVersion: apiextensions.k8s.io/v1beta1
kind: CustomResourceDefinition
metadata:
  name: kongconsumers.configuration.konghq.com
spec:
  additionalPrinterColumns:
  - JSONPath: .username
    description: Username of a Kong Consumer
    name: Username
    type: string
  - JSONPath: .metadata.creationTimestamp
    description: Age
    name: Age
    type: date
  group: configuration.konghq.com
  names:
    kind: KongConsumer
    plural: kongconsumers
    shortNames:
    - kc
  scope: Namespaced
  validation:
    openAPIV3Schema:
      properties:
        credentials:
          items:
            type: string
          type: array
        custom_id:
          type: string
        username:
          type: string
  version: v1
---
apiVersion: apiextensions.k8s.io/v1beta1
kind: CustomResourceDefinition
metadata:
  name: kongcredentials.configuration.konghq.com
spec:
  additionalPrinterColumns:
  - JSONPath: .type
    description: Type of credential
    name: Credential-type
    type: string
  - JSONPath: .metadata.creationTimestamp
    description: Age
    name: Age
    type: date
  - JSONPath: .consumerRef
    description: Owner of the credential
    name: Consumer-Ref
    type: string
  group: configuration.konghq.com
  names:
    kind: KongCredential
    plural: kongcredentials
  scope: Namespaced
  validation:
    openAPIV3Schema:
      properties:
        consumerRef:
          type: string
        type:
          type: string
      required:
      - consumerRef
      - type
  version: v1
---
apiVersion: apiextensions.k8s.io/v1beta1
kind: CustomResourceDefinition
metadata:
  name: kongingresses.configuration.konghq.com
spec:
  group: configuration.konghq.com
  names:
    kind: KongIngress
    plural: kongingresses
    shortNames:
    - ki
  scope: Namespaced
  validation:
    openAPIV3Schema:
      properties:
        proxy:
          properties:
            connect_timeout:
              minimum: 0
              type: integer
            path:
              pattern: ^/.*$
              type: string
            protocol:
              enum:
              - http
              - https
              - grpc
              - grpcs
              type: string
            read_timeout:
              minimum: 0
              type: integer
            retries:
              minimum: 0
              type: integer
            write_timeout:
              minimum: 0
              type: integer
          type: object
        route:
          properties:
            headers:
              additionalProperties:
                items:
                  type: string
                type: array
              type: object
            https_redirect_status_code:
              type: integer
            methods:
              items:
                type: string
              type: array
            preserve_host:
              type: boolean
            protocols:
              items:
                enum:
                - http
                - https
                - grpc
                - grpcs
                type: string
              type: array
            regex_priority:
              type: integer
            strip_path:
              type: boolean
        upstream:
          properties:
            algorithm:
              enum:
              - round-robin
              - consistent-hashing
              - least-connections
              type: string
            hash_fallback:
              type: string
            hash_fallback_header:
              type: string
            hash_on:
              type: string
            hash_on_cookie:
              type: string
            hash_on_cookie_path:
              type: string
            hash_on_header:
              type: string
            healthchecks:
              properties:
                active:
                  properties:
                    concurrency:
                      minimum: 1
                      type: integer
                    healthy:
                      properties:
                        http_statuses:
                          items:
                            type: integer
                          type: array
                        interval:
                          minimum: 0
                          type: integer
                        successes:
                          minimum: 0
                          type: integer
                      type: object
                    http_path:
                      pattern: ^/.*$
                      type: string
                    timeout:
                      minimum: 0
                      type: integer
                    unhealthy:
                      properties:
                        http_failures:
                          minimum: 0
                          type: integer
                        http_statuses:
                          items:
                            type: integer
                          type: array
                        interval:
                          minimum: 0
                          type: integer
                        tcp_failures:
                          minimum: 0
                          type: integer
                        timeout:
                          minimum: 0
                          type: integer
                      type: object
                  type: object
                passive:
                  properties:
                    healthy:
                      properties:
                        http_statuses:
                          items:
                            type: integer
                          type: array
                        interval:
                          minimum: 0
                          type: integer
                        successes:
                          minimum: 0
                          type: integer
                      type: object
                    unhealthy:
                      properties:
                        http_failures:
                          minimum: 0
                          type: integer
                        http_statuses:
                          items:
                            type: integer
                          type: array
                        interval:
                          minimum: 0
                          type: integer
                        tcp_failures:
                          minimum: 0
                          type: integer
                        timeout:
                          minimum: 0
                          type: integer
                      type: object
                  type: object
              type: object
            host_header:
              type: string
            slots:
              minimum: 10
              type: integer
          type: object
  version: v1
---
apiVersion: apiextensions.k8s.io/v1beta1
kind: CustomResourceDefinition
metadata:
  name: kongplugins.configuration.konghq.com
spec:
  additionalPrinterColumns:
  - JSONPath: .plugin
    description: Name of the plugin
    name: Plugin-Type
    type: string
  - JSONPath: .metadata.creationTimestamp
    description: Age
    name: Age
    type: date
  - JSONPath: .disabled
    description: Indicates if the plugin is disabled
    name: Disabled
    priority: 1
    type: boolean
  - JSONPath: .config
    description: Configuration of the plugin
    name: Config
    priority: 1
    type: string
  group: configuration.konghq.com
  names:
    kind: KongPlugin
    plural: kongplugins
    shortNames:
    - kp
  scope: Namespaced
  validation:
    openAPIV3Schema:
      properties:
        config:
          type: object
        disabled:
          type: boolean
        plugin:
          type: string
        protocols:
          items:
            enum:
            - http
            - https
            - tcp
            - tls
            type: string
          type: array
        run_on:
          enum:
          - first
          - second
          - all
          type: string
      required:
      - plugin
  version: v1
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kong-serviceaccount
  namespace: kong
---
apiVersion: rbac.authorization.k8s.io/v1beta1
kind: ClusterRole
metadata:
  name: kong-ingress-clusterrole
rules:
- apiGroups:
  - ""
  resources:
  - endpoints
  - nodes
  - pods
  - secrets
  verbs:
  - list
  - watch
- apiGroups:
  - ""
  resources:
  - nodes
  verbs:
  - get
- apiGroups:
  - ""
  resources:
  - services
  verbs:
  - get
  - list
  - watch
- apiGroups:
  - networking.k8s.io
  - extensions
  resources:
  - ingresses
  verbs:
  - get
  - list
  - watch
- apiGroups:
  - ""
  resources:
  - events
  verbs:
  - create
  - patch
- apiGroups:
  - networking.k8s.io
  - extensions
  resources:
  - ingresses/status
  verbs:
  - update
- apiGroups:
  - configuration.konghq.com
  resources:
  - kongplugins
  - kongcredentials
  - kongconsumers
  - kongingresses
  verbs:
  - get
  - list
  - watch
- apiGroups:
  - ""
  resourceNames:
  - ingress-controller-leader-kong
  resources:
  - configmaps
  verbs:
  - get
  - update
- apiGroups:
  - ""
  resources:
  - configmaps
  verbs:
  - create
---
apiVersion: rbac.authorization.k8s.io/v1beta1
kind: ClusterRoleBinding
metadata:
  name: kong-ingress-clusterrole-nisa-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: kong-ingress-clusterrole
subjects:
- kind: ServiceAccount
  name: kong-serviceaccount
  namespace: kong
---
apiVersion: v1
data:
  servers.conf: |
    # Prometheus metrics server
    server {
        server_name kong_prometheus_exporter;
        listen 0.0.0.0:9542; # can be any other port as well
        access_log off;

        location /metrics {
            default_type text/plain;
            content_by_lua_block {
                 local prometheus = require "kong.plugins.prometheus.exporter"
                 prometheus:collect()
            }
        }

        location /nginx_status {
            internal;
            stub_status;
        }
    }
    # Health check server
    server {
        server_name kong_health_check;
        listen 0.0.0.0:9001; # can be any other port as well

        access_log off;
        location /health {
          return 200;
        }
    }
kind: ConfigMap
metadata:
  name: kong-server-blocks
  namespace: kong
---
apiVersion: v1
kind: Service
metadata:
  labels:
    app: ingress-kong
  name: kong-admin
  namespace: kong
spec:
  ports:
  - name: kong-admim
    port: 8001
    protocol: TCP
    targetPort: 8001
  selector:
    app: ingress-kong
---
apiVersion: v1
kind: Service
metadata:
  name: kong-proxy
  namespace: kong
spec:
  ports:
  - name: proxy
    port: 80
    nodePort: 80
    protocol: TCP
    targetPort: 8000
  - name: proxy-ssl
    port: 443
    nodePort: 443
    protocol: TCP
    targetPort: 8443
  selector:
    app: ingress-kong
  type: NodePort 
---
apiVersion: v1
kind: Service
metadata:
  name: kong-validation-webhook
  namespace: kong
spec:
  ports:
  - name: webhook
    port: 443
    protocol: TCP
    targetPort: 8080
  selector:
    app: ingress-kong
---
apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app: ingress-kong
  name: ingress-kong
  namespace: kong
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ingress-kong
  template:
    metadata:
      annotations:
        prometheus.io/port: "9542"
        prometheus.io/scrape: "true"
        traffic.sidecar.istio.io/includeInboundPorts: ""
      labels:
        app: ingress-kong
    spec:
      containers:
      - env:
        - name: KONG_DATABASE
          value: "off"
        - name: KONG_NGINX_WORKER_PROCESSES
          value: "1"
        - name: KONG_NGINX_HTTP_INCLUDE
          value: /kong/servers.conf
        - name: KONG_ADMIN_ACCESS_LOG
          value: /dev/stdout
        - name: KONG_ADMIN_ERROR_LOG
          value: /dev/stderr
        - name: KONG_ADMIN_LISTEN
          value: 0.0.0.0:8001
        - name: KONG_PROXY_LISTEN
          value: 0.0.0.0:8000, 0.0.0.0:8443 ssl http2
        - name: KONG_NGINX_PROXY_IGNORE_INVALID_HEADERS
          value: "off"
        image: kong:1.4.2-centos 
        lifecycle:
          preStop:
            exec:
              command:
              - /bin/sh
              - -c
              - kong quit
        livenessProbe:
          failureThreshold: 3
          httpGet:
            path: /health
            port: 9001
            scheme: HTTP
          initialDelaySeconds: 30
          periodSeconds: 10
          successThreshold: 1
          timeoutSeconds: 1
        name: proxy
        ports:
        - containerPort: 8001
          name: admin
          protocol: TCP
        - containerPort: 8000
          name: proxy
          protocol: TCP
        - containerPort: 8443
          name: proxy-ssl
          protocol: TCP
        - containerPort: 9542
          name: metrics
          protocol: TCP
        readinessProbe:
          failureThreshold: 3
          httpGet:
            path: /health
            port: 9001
            scheme: HTTP
          periodSeconds: 10
          successThreshold: 1
          timeoutSeconds: 1
        securityContext:
          runAsUser: 1000
        volumeMounts:
        - mountPath: /kong
          name: kong-server-blocks
      - args:
        - /kong-ingress-controller
        - --kong-url=http://localhost:8001
        - --admin-tls-skip-verify
        - --publish-service=kong/kong-proxy
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
        image: kong-docker-kubernetes-ingress-controller.bintray.io/kong-ingress-controller:0.7.1
        imagePullPolicy: IfNotPresent
        livenessProbe:
          failureThreshold: 3
          httpGet:
            path: /healthz
            port: 10254
            scheme: HTTP
          periodSeconds: 10
          successThreshold: 1
          timeoutSeconds: 1
        name: ingress-controller
        ports:
        - containerPort: 8080
          name: webhook
          protocol: TCP
        readinessProbe:
          failureThreshold: 3
          httpGet:
            path: /healthz
            port: 10254
            scheme: HTTP
          periodSeconds: 10
          successThreshold: 1
          timeoutSeconds: 1
      serviceAccountName: kong-serviceaccount
      volumes:
      - configMap:
          name: kong-server-blocks
        name: kong-server-blocks
```
作为ingress controller，移除了对postgres依赖，更方便运维；也创建了4种crd资源，更易扩容k8s的功能
- kongconsumers.configuration.konghq.com
- kongcredentials.configuration.konghq.com
- kongingresses.configuration.konghq.com
- kongplugins.configuration.konghq.com

```
# kubectl apply -f ingress-kong/all-in-one-dbless.yaml
```
查看pod
```
# kubectl -n kong get pod
NAME                           READY   STATUS    RESTARTS   AGE
ingress-kong-c8f9b76d5-mpdsr   2/2     Running   1          21h
```

### 安装konga

konga是kong的可视化界面
```
# vim ingress-kong/konga.yaml 
---
apiVersion: v1
kind: Namespace
metadata:
  annotations:
    description: Kong UI
  name: kong
---
apiVersion: v1
kind: Service
metadata:
  name: konga
  namespace: kong
  labels:
    app.kubernetes.io/name: konga
    app.kubernetes.io/instance: konga
spec:
  type: NodePort 
  ports:
    - port: 80
      targetPort: http
      protocol: TCP
      nodePort: 8080
      name: http
  selector:
    app.kubernetes.io/name: konga
    app.kubernetes.io/instance: konga
---
apiVersion: v1
kind: ConfigMap
metadata:
  name:  konga-config
  namespace: kong
  labels:
    app.kubernetes.io/name: konga
    app.kubernetes.io/instance: konga
data:
  KONGA_SEED_USER_DATA_SOURCE_FILE: "/etc/konga-config-files/userdb.data"
  KONGA_SEED_KONG_NODE_DATA_SOURCE_FILE: "/etc/konga-config-files/kong_node.data"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name:  konga-config-file
  namespace: kong
  labels:
    app.kubernetes.io/name: konga
    app.kubernetes.io/instance: konga
data:
  userdb.data: |-
    module.exports = [
        {
            "username": "admin",
            "email": "admin@test.com",
            "firstName": "Admin",
            "lastName": "Administrator",
            "admin": true,
            "active" : true,
            "password": "admin@123"
        }
    ]
  kong_node.data: |-
    module.exports = [
        {
            "name": "kong",
            "type": "default",
            "kong_admin_url": "http://kong-admin:8001",
            "health_checks": false
        }
    ]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: konga
  namespace: kong
  labels:
    app.kubernetes.io/name: konga
    app.kubernetes.io/instance: konga
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: konga
      app.kubernetes.io/instance: konga
  template:
    metadata:
      labels:
        app.kubernetes.io/name: konga
        app.kubernetes.io/instance: konga
    spec:
      containers:
        - name: konga
          image: pantsel/konga:next
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 1337
              protocol: TCP
          livenessProbe:
            httpGet:
              path: /
              port: http
          readinessProbe:
            httpGet:
              path: /
              port: http
          envFrom:
            - configMapRef:
                name: konga-config
          volumeMounts:
          - mountPath: /etc/konga-config-files
            name: config-file-volume
          resources:
            requests:
              cpu: 500m
              memory: 256Mi
      volumes:
      - configMap:
          defaultMode: 420
          name: konga-config-file
        name: config-file-volume
```

```
# kubectl apply -f ingress-kong/konga.yaml
```
查看konga pod
```
# kubectl -n kong get pod
NAME                           READY   STATUS    RESTARTS   AGE
ingress-kong-c8f9b76d5-mpdsr   2/2     Running   1          21h
konga-855669bcb5-2n56k         1/1     Running   0          21h
```

konga的svc是NodePort类型，映射端口为8080
```
# kubectl -n kong get svc
NAME                      TYPE        CLUSTER-IP       EXTERNAL-IP   PORT(S)                 AGE
kong-admin                ClusterIP   172.20.253.211   <none>        8001/TCP                21h
kong-proxy                NodePort    172.20.253.5     <none>        80:80/TCP,443:443/TCP   21h
kong-validation-webhook   ClusterIP   172.20.254.174   <none>        443/TCP                 21h
konga                     NodePort    172.20.253.8     <none>        80:8080/TCP             21h
```
浏览器访问http://<your-server-ip>:8080；
点击APPLICATION->CONNECTIONS->ACTIVATE 可看到界面规则信息，直接调的kong-admin api获取

### 应用场景

部署个nginx

```
# vim test-nginx-ing/nginx.yaml 
---
apiVersion: extensions/v1beta1
kind: Deployment
metadata:
  labels:
    run: test-hello
  name: test-hello
  namespace: default
spec:
  progressDeadlineSeconds: 600
  replicas: 1
  revisionHistoryLimit: 10
  selector:
    matchLabels:
      run: test-hello
  strategy:
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 25%
    type: RollingUpdate
  template:
    metadata:
      labels:
        run: test-hello
    spec:
      containers:
      - image: nginx:alpine
        imagePullPolicy: IfNotPresent
        name: test-hello
        ports:
        - containerPort: 80
          protocol: TCP
      dnsPolicy: ClusterFirst
      restartPolicy: Always
---
apiVersion: v1
kind: Service
metadata:
  name: test-hello
  namespace: default
spec:
  ports:
  - port: 80
    protocol: TCP
    targetPort: 80
  selector:
    run: test-hello
  type: ClusterIP
---
apiVersion: networking.k8s.io/v1beta1 
kind: Ingress
metadata:
  name: test-hello
spec:
  rules:
  - host: hello.test.com
    http:
      paths:
      - path: /
        backend:
          serviceName: test-hello
          servicePort: 80
```

curl测试验证
```
# curl -I -H "Host:hello.test.com" http://<your-server-ip>
HTTP/1.1 200 OK
Content-Type: text/html; charset=UTF-8
Content-Length: 612
Connection: keep-alive
Server: nginx/1.17.6
Date: Wed, 18 Dec 2019 07:28:42 GMT
Last-Modified: Tue, 19 Nov 2019 15:14:41 GMT
ETag: "5dd406e1-264"
Accept-Ranges: bytes
X-Kong-Upstream-Latency: 1
X-Kong-Proxy-Latency: 0
Via: kong/1.4.2
```

#### 添加kong plugin

采用KongPlugin crd方式, 因为没有运行postgres，kong admin API不让调用

创建个http返回自带header
```
# vim test-kong-plugins/add-response-header.yaml 
apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata:
  name: add-response-header
config:
  add:
    headers:
    - "demo: injected-by-kong"
```

```
# kubectl apply -f test-kong-plugins/add-response-header.yaml 
```

查看新创建的kongplugins
```
[root@VM_12_85_centos ~/ingress-kong]# kubectl get kongplugins.configuration.konghq.com 
NAME                  PLUGIN-TYPE            AGE
add-response-header   response-transformer   2s
```

关联ingress使用这个kongplugins
```
kubectl patch ingress test-hello -p '{"metadata":{"annotations":{"plugins.konghq.com":"add-response-header"}}}'
```

再次curl测试验证，返回header里带有demo
```
# curl -I -H "Host:hello.test.com" http://9.134.12.85
HTTP/1.1 200 OK
Content-Type: text/html; charset=UTF-8
Content-Length: 612
Connection: keep-alive
Server: nginx/1.17.6
Date: Wed, 18 Dec 2019 07:55:10 GMT
Last-Modified: Tue, 19 Nov 2019 15:14:41 GMT
ETag: "5dd406e1-264"
Accept-Ranges: bytes
demo:  injected-by-kong
X-Kong-Upstream-Latency: 0
X-Kong-Proxy-Latency: 0
Via: kong/1.4.2
```

#### 设置超时时间

采用KongIngress crd方式

```
# vim test-kongingress-timeout/sample-customization.yaml 
apiVersion: configuration.konghq.com/v1
kind: KongIngress
metadata:
  name: sample-customization
proxy:
  connect_timeout: 5000
  retries: 10
  read_timeout: 120000
  write_timeout: 120000
```

单位毫秒
- connect_timeout: 连接超时时间
- read_timeout：读超时时间
- write_timeout：写超时时间

```
# kubectl apply -f test-kongingress-timeout/sample-customization.yaml
```

查看新创建的KongIngress
```
# kubectl get kongingresses.configuration.konghq.com 
NAME                   AGE
sample-customization   22h
```

关联这个KongIngress
```
kubectl patch svc test-hello -p '{"metadata":{"annotations":{"configuration.konghq.com":"sample-customization"}}}'
```
从konga界面Services可以看到超时时间，重试次数生效

#### 设置HTTPS

以harbor为例

创建私钥
```
openssl genrsa -out test-harbor.key 2048
```

用此私钥创建证书签名请求文件(csr)
```
openssl req -new -key test-harbor.key -out test-harbor.csr -subj "/CN=*.tstack.com/OU=TCNP"
```

颁发证书
```
openssl x509 -req -in test-harbor.csr \
         -CA /etc/kubernetes/pki/ca.crt \
         -CAkey /etc/kubernetes/pki/ca.key \
         -CAcreateserial \
         -out test-harbor.crt \
         -days 3650
```

安装harbor
```
kubectl create ns test
kubectl -n test create secret tls test-harbor --key test-harbor.key --cert test-harbor.crt
helm install --namespace test -n test-harbor harbor/
```

kong ingress controller默认strip_path为true, 不符合harbor内部调用
```
# cat test-tls/https.yaml 
apiVersion: configuration.konghq.com/v1
kind: KongIngress
metadata:
  name: https-test
  namespace: test 
route:
  strip_path: false
```
这里指定了namespace，因为harbor在test命名空间

```
# kubectl apply -f test-tls/https.yaml 
```

```
# kubectl get kongingresses.configuration.konghq.com  -n test
NAME         AGE
https-test   7s
```

关联这个KongIngress
```
# kubectl -n test patch ingress test-harbor-harbor-ingress -p '{"metadata":{"annotations":{"configuration.konghq.com":"https-test"}}}'
```
用docker login验证登录，推送镜像

#### 集成istio

0.6版本天生支持集成isito, ingress规则中annotation中不要带有kubernetes.io/ingress.class: nginx即可

#### 配置健康检查

以一个httpbin的服务为例
```
# vim httpbin.yaml 
---
apiVersion: v1
kind: Service
metadata:
  name: httpbin
  labels:
    app: httpbin
spec:
  ports:
  - name: http
    port: 80
    targetPort: 80
  selector:
    app: httpbin
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: httpbin
spec:
  replicas: 1
  selector:
    matchLabels:
      app: httpbin
  template:
    metadata:
      labels:
        app: httpbin
    spec:
      containers:
      - image: docker.io/kennethreitz/httpbin
        name: httpbin
        ports:
        - containerPort: 80
---
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: demo
spec:
  rules:
  - http:
      paths:
      - path: /foo
        backend:
          serviceName: httpbin
          servicePort: 80
```

```
# kubectl apply -f httpbin.yaml 
```

curl调用验证服务是否ok
```
# curl -i -H "Host:test.xxx.com" http://<kong-server-ip>/foo/status/200
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Content-Length: 0
Connection: keep-alive
Server: gunicorn/19.9.0
Date: Tue, 11 Feb 2020 02:34:04 GMT
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
X-Kong-Upstream-Latency: 2
X-Kong-Proxy-Latency: 0
Via: kong/1.4.2
```

创建健康检查资源，同时配置了主动健康检查和被动健康检查

- 主动健康检查：每间隔5s,对http_path成功3次为健康, 失败2次为不健康;
- 被动健康检查：这里配置被动健康检查只是为了触发效果, 成功2次为健康, 失败3次为不健康;

当被动健康检查为不健康的状态后, 且不会自动恢复; 但如果和主动健康检查配置使用的话，等到了主动检查间隔，成功的话会从不健康状态转变为健康状态。
```
# vim demo-health-checking.yaml  
apiVersion: configuration.konghq.com/v1
kind: KongIngress
metadata:
    name: demo-health-checking
upstream:
  healthchecks:
    active:
      healthy:
        interval: 5
        successes: 2
      http_path: /status/200
      type: http
      unhealthy:
        http_failures: 3
        interval: 5
    passive:
      healthy:
        successes: 2
      unhealthy:
        http_failures: 3 
```

关联健康检查和httpbin的service资源
```
kubectl patch svc httpbin -p '{"metadata":{"annotations":{"configuration.konghq.com":"demo-health-checking"}}}'
```

手动触发三次返回码为500判定为不健康状态
```
# curl -i -H "Host:test.xxx.com" http://<kong-server-ip>/foo/status/500
# curl -i -H "Host:test.xxx.com" http://<kong-server-ip>/foo/status/500
# curl -i -H "Host:test.xxx.com哎" http://<kong-server-ip>/foo/status/500

# curl -i -H "Host:test.xxx.com" http://<kong-server-ip>/foo/status/200
  HTTP/1.1 503 Service Temporarily Unavailable
  Date: Tue, 11 Feb 2020 08:40:34 GMT
  Content-Type: application/json; charset=utf-8
  Connection: keep-alive
  Content-Length: 58
  X-Kong-Response-Latency: 0
  Server: kong/1.4.2
  
  {"message":"failure to get a peer from the ring-balancer"}

# 过了5*2秒后，触发主动健康检查，转变为健康状态
# curl -i -H "Host:test.xxx.com" http://<kong-server-ip>/foo/status/200
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Content-Length: 0
Connection: keep-alive
Server: gunicorn/19.9.0
Date: Tue, 11 Feb 2020 08:45:11 GMT
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
X-Kong-Upstream-Latency: 2
X-Kong-Proxy-Latency: 0
Via: kong/1.4.2
```

调用接口获取upstreams列表，每条ingress对应kong的service、route、upstream；
upstream详情带有健康状态
```
curl -X GET \
  http://<kong-server-ip>:8001/upstreams
```

获取某个upstream健康状态
```
curl -X GET \
  http://<kong-server-ip>:8001/upstreams/<upstream-id>/health
```
data[0].health==HEALTHY为健康状态，data[0].health==UNHEALTHY为不健康状态; health还有种DNS_ERROR状态

#### 启用Prometheus plugin

加载prometheus plugin，新增annotations
```
# kubectl -n kong edit deployments. ingress-kong
spec:
  template:
    metadata:
      annotations:
        prometheus.io/port: "9542"
        prometheus.io/scrape: "true"
    spec:
      containers:
      - env:
        - name: KONG_PLUGINS
          value: ...,prometheus
```

声明为global，每个请求都被prometheus跟踪
```
echo "apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata:
  labels:
    global: \"true\"
  name: prometheus
plugin: prometheus
" | kubectl apply -f -
```

获取kong metrics
```
CLUSTER_IP=`kubectl -n kong get services kong-admin --output=jsonpath={.spec.clusterIP}`
curl http://${CLUSTER_IP}:8001/metrics
```

编辑prometheus配置，加入kong数据获取
```
# kubectl -n xxx edit cm prometheus-server 

data:
 prometheus.yml: |
    scrape_configs:
    - job_name: kong
      scrape_interval: 10s
      scrape_timeout: 10s
      static_configs:
      - targets:
        - kong-admin.kong.svc.cluster.local:8001
```
在prometheus web上能够查询到kong的metrics，结合grafana展示参考：[https://github.com/yaoice/kong-plugin-prometheus/blob/0.6.0-add_request_count/grafana/kong-official.json](https://github.com/yaoice/kong-plugin-prometheus/blob/0.6.0-add_request_count/grafana/kong-official.json)

#### 启用basic-auth plugin

```
# vim basic_auth.yaml 
apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata:
  name: basic-auth
  namespace: default
config:
  hide_credentials: true
plugin: basic-auth
---
apiVersion: configuration.konghq.com/v1
kind: KongConsumer
metadata:
  name: elasticsearch 
  namespace: default
username: elasticsearch
---
apiVersion: configuration.konghq.com/v1
kind: KongCredential
metadata:
  name: elasticsearch 
  namespace: default
consumerRef: elasticsearch
type: basic-auth
config:
  username: elasticsearch 
  password: test 
```

```
kubectl apply -f basic_auth.yaml 
```

关联basic-auth plugin
```
kubectl -n default patch ingress elasticsearch -p '{"metadata":{"annotations":{"plugins.konghq.com":"basic-auth"}}}'
```

测试
```
# curl -I -H 'Authorization: Basic ZWxhc3RpY3NlYXJjaDp0ZXN0' http://elasticsearch.xxx.com/ 
HTTP/1.1 200 OK
Content-Type: application/json; charset=UTF-8
Content-Length: 519
Connection: keep-alive
X-Kong-Upstream-Latency: 1
X-Kong-Proxy-Latency: 1
Via: kong/1.4.2
```

### 参考链接

- [KongIngress使用](https://github.com/Kong/kubernetes-ingress-controller/blob/master/docs/guides/using-kongingress-resource.md)
- [KongPlugin使用](https://github.com/Kong/kubernetes-ingress-controller/blob/master/docs/guides/using-kongplugin-resource.md)
- [Kong CRD](https://github.com/Kong/kubernetes-ingress-controller/blob/master/docs/references/custom-resources.md)
- [Kong集成isito](https://konghq.com/blog/kong-ingress-controller-0-6-released-istio-support-admission-controller-support/)
- [Kong配置健康检查](https://github.com/Kong/kubernetes-ingress-controller/blob/master/docs/guides/configuring-health-checks.md)
- [Kong-ingress-controllerg高可用](https://github.com/Kong/kubernetes-ingress-controller/blob/master/docs/concepts/ha-and-scaling.md)
- [ingress-kong-controller集成prometheus、grafana](https://github.com/Kong/kubernetes-ingress-controller/blob/0.7.1/docs/guides/prometheus-grafana.md)
- [kong grafana界面json](https://github.com/Kong/kong-plugin-prometheus/blob/master/grafana/kong-official.json)