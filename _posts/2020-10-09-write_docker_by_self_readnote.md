---
layout: post
title: 《自己动手写docker》阅读笔记
subtitle: ""
catalog: true
hide: true
tags:
     - k8s
---

### 环境

- go版本：1.13.12
- 系统：CentOS 7.5

### Namespace

>Linux Namespace是Kernel的一个功能，它可以隔离一系列的系统资源，
>比如PID(Process ID)、User ID、Network等。 
>一般看到这里，很多人会想到一个命令chroot，就像chroot允许把当前目录变成根目录一样(被隔离开来的), 
>Namespace也可以在一些资源上，将进程隔离起来，这些资源包括进程树、网络接口、挂载点等。

Linux共实现了6种不同类型的Namespace

| Namespace类型  |  系统调用参数 | 内核版本  |
|---------------|-------------|----------|
| Mount Namespace | CLONE NEWNS | 2.4.19|
| UTS Namespace  | CLONE NEWUTS  | 2.6.19 |
| IPC Namespace  | CLONE NEWIPC  | 2.6.19 |
| PID Namespace  | CLONE NEWPID  | 2.6.24 |
| Network Namespace | CLONE NEWNET  | 2.6.29 |
| User Namespace  | CLONE NEWUSER | 3.8 |

Namespace的API主要使用3个系统调用
- clone()：创建新进程。根据系统调用参数来判断哪些类型的Namespace被创建，而且它们的子进程也会被包含到这些Namespace中.
- unshare()：将进程移出某个Namespace.
- setns()：将进程加入到 Namespace中。

#### UTS Namespace

>UTS Namespace主要用来隔离nodename和domainname两个系统标识。在UTS Namespace里面，每个Namespace允许有自己的hostname。

Go创建UTS Namespace，GO封装了对clone()函数的调用，执行这段代码后会进入到一个sh运行环境
```

```


### 参考链接

- 