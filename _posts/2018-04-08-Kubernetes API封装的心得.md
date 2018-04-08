---
layout: post
title: Kubernetes API二次封装的心得
subtitle: ""
catalog: true
tags:
     - k8s
---

## 背景

来公司的第一个任务就是对接公司内部某容器平台，后面又陆陆续续对接了其它容器平台；来了新领导后，觉得容器这么关键的东西必须掌握在自己团队身上，不过想想我也觉得是这样的，k8s算是可以颠覆OpenStack的存在，现在采用k8s管理容器的公司也越来越多了；所以今年的工作重心主要都是k8s上，近段时间主要在研究如何封装k8s api，目的是对外提供一个更易调用的接口。个人折腾了一段时间，特此做个笔记，写得不好，还请勿喷哈！


### 环境

- Go (1.9.2)
- Kubernetes (v1.9.1)
- Docker (17.12.0-ce)
- client-go (kubernetes-1.9.1)
- Beego     (1.9.2)
- Bee       (v1.9.1)


### 技术栈

  用google神器查阅了很多资料关于如何封装k8s API，几乎都是推荐采用client-go. client-go是k8s官方项目，还是相当靠谱的；所以这里采用client-go + beego来搭建API框架. 为何用beego，支持下国产，用得上手就好。

  接下来是个人的学习总结：
  1. beego快速入门: https://beego.me/quickstart, 按照beego官方例子，先跑个hello world出来，哈哈！
  2. beego开发文档: https://beego.me/docs/intro/, 开发文档过一遍
  3. beego深入进阶: https://beego.me/products, beego官方列举的比较优秀的beego项目，通过阅读代码，学习别人的技巧
  4. client-go框架介绍: https://www.kubernetes.org.cn/1309.html ,来自Google徐超大神的介绍，有助于熟悉client-go的整体框架
  5. client-go的官方例子：https://github.com/kubernetes/client-go/tree/kubernetes-1.9.1/examples ，虽然不是很全，但还是值得看一看

### API归类

  以下是我的分类, 把namespaces换成了project概念，虽然没有覆盖所有k8s所有概念，但可以支持普通应用的创建访问.

  - project:  项目，租户，部门（未封装API）
  - app:      应用，是deployment
  - flavor:   应用类型, 是resourceLimit(未封装API)
  - service:  服务端口
  - ingress:  反向代理

  因为在beego中会调用到client-go，所以有必要了解client-go如何用；举例来说，要封装原生k8s ingress api:


  1. 打开原生k8s API自带的swagger: http://xxxx:8080/swagger-ui , 有可能没开放，需要配置下kube-apiserver

  <img src="/img/posts/2018-04-08/1.png" width="800" height="200" />

  2. 打开k8s.io/client-go/kubernetes/clientset.go找到ExtensionsV1beta1() ，这里采用clientset方式

  3. k8s.io/client-go/kubernetes//typed/extensions/v1beta1/extensions_client.go中找到ExtensionsV1beta1Interface1

  4. k8s.io/client-go/kubernetes//typed/extensions/v1beta1/ingress.go 找到IngressesGetter、IngressInterface, IngressInterface接口中就定义了对应k8s api ingress的实现

### API框架搭建

  参考这里：https://beego.me/docs/advantage/docs.md， 采用API自动化，不过现在只支持二级路由

    iceyaos-MacBook-Pro:ice iceyao$ cat routers/router.go

    package routers

    import (
    	"github.com/yaoice/ice/controllers"

    	"github.com/astaxie/beego"
    )

    func init() {
    	ns := beego.NewNamespace("/apis/v1",
           beego.NSNamespace("/projects",
                beego.NSInclude(
                    &controllers.ProjectsController{},
                ),
            ),
            beego.NSNamespace("/projects/:project/apps",
    			beego.NSInclude(
    				&controllers.AppsController{},
    			),
    		),
            beego.NSNamespace("/projects/:project/ingresses",
                beego.NSInclude(
                    &controllers.IngressesController{},
                ),
            ),
            beego.NSNamespace("/projects/:project/services",
                beego.NSInclude(
                    &controllers.ServicesController{},
                ),
            ),
            beego.NSNamespace("/flavors",
                beego.NSInclude(
                    &controllers.FlavorsController{},
                ),
            ),
            beego.NSNamespace("/images",
                beego.NSInclude(
                    &controllers.ImagesController{},
                ),
            ),
    	)
    	beego.AddNamespace(ns)
    }

具体项目地址：https://github.com/yaoice/ice

### 效果

  运行，默认监听在0.0.0.0:8080

    iceyaos-MacBook-Pro:ice iceyao$ bee run -gendoc=true -downdoc=true


  浏览器访问：http://xxx:8080/swagger/

  <img src="/img/posts/2018-04-08/2.png" width="800" height="500" />
