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
  replicas: 1
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
        image: kong-docker-kubernetes-ingress-controller.bintray.io/kong-ingress-controller:0.6.2
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

### 参考链接

- [KongIngress使用](https://github.com/Kong/kubernetes-ingress-controller/blob/master/docs/guides/using-kongingress-resource.md)
- [KongPlugin使用](https://github.com/Kong/kubernetes-ingress-controller/blob/master/docs/guides/using-kongplugin-resource.md)
- [Kong CRD](https://github.com/Kong/kubernetes-ingress-controller/blob/master/docs/references/custom-resources.md)
