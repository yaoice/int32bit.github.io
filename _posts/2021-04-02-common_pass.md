---
layout: post
title: 常用中间件服务部署方案
subtitle: ""
catalog: true
tags:
- k8s
---


## 常用中间件服务

## 1. redis

### 1.1 简介

> Redis是一种开放源代码（BSD许可）的内存中数据结构存储，用作数据库，缓存和消息代理。 
> Redis提供数据结构，例如字符串，哈希，列表，集合，带范围查询的排序集合，位图，超日志，地理空间索引和流。 
> Redis具有内置的复制，Lua脚本，LRU逐出，事务和不同级别的磁盘持久性，并通过Redis Sentinel和Redis Cluster自动分区提供了高可用性。

### 1.2 集群部署方案

<img src="/img/posts/2021-04-02/redis_standalone.png"/>

#### 1.2.1 主从模式

redis 2.8版本之前采用的模式
``` 
        +
        |
        |
        |    read                                +-------------+
        +---------------------------------------->             |
        |                                        |   Slave     |
        |                        +--------------->             |
        |                        |    单向复制     +-------------+
        |                        |
        |                        |
        |                 +------+------+
        |   read/write    |             |
Client  +----------------->   Master    |
        |                 |             |
        |                 +------+------+
        |                        |
        |                        |               +-------------+
        |                        +--------------->             |
        |   read                      单向复制     |   Slave     |
        +---------------------------------------->             |
        |                                        +-------------+
        |
        |
        +                   
```
Master节点支持read/write，Slave节点只支持read，可以分担Master节点读的压力；如果Master节点宕机，
需要人工干预让Slave节点成为主节点，同时其它的从节点跟这个新的Master节点同步，Client端访问的主节点

#### 1.2.2 哨兵(Sentinel)模式

redis 2.8版本之后采用的模式

<img src="/img/posts/2021-04-02/redis_sentinel.png"/>

Client通过哨兵集群访问redis数据集群，哨兵集群监控着整个redis数据集群，每个哨兵节点通过向其它Master、Slave、Sentinel节点发送PING命令标记其是否下线。
哨兵集群由单个或多个哨兵节点组成，哨兵节点不存储数据。由上图可以看出哨兵模式也是基于主从模式的，哨兵模式可以自动实现主从切换，哨兵节点之间会协商Master节点的状态，
如果Master节点处于SDOWN状态，则投票选出新的Master节点, 将其它Slave节点向新Master节点进行复制。 这种模式下，对于集群容量达到上限时在线扩容较难。

#### 1.2.3 官方Cluster集群模式

前面两种模式，数据都是先存在Master节点上，单个节点存储能力存在上限；Cluster集群模式是一种服务端Sharding模式，redis 3.0版本之后的模式。
Cluster集群模式会对数据进行分片存储。

<img src="/img/posts/2021-04-02/redis_cluster.png"/>

- 数据分片：集群key空间(Master节点集群组成)分割为16384个slots，通过hash方式将数据存储到不同的分片上，分片公式`HASH_SLOT = CRC16(key) & 16384`
- 数据读写：读请求分配给Slave节点，写请求分配给Master节点；Master节点可以在线扩容，然后Master节点之间同步数据(16384个slots重新分配，内部完成)
，从Master节点复制数据到Slave节点
- Master选举： Master节点故障，自动从这个Master节点下面的Slave节点选举一个成为新Master节点

#### 1.2.4 容器化部署

operator方式 vs Helm chart方式? 结合应用商店的话，更推荐使用chart方式，配置参数更容易抽象出来，不像operator，需要修改代码实现。

redis operator方式部署架构:
<img src="/img/posts/2021-04-02/redis_operator.png"/>

redis operator功能支持优先，目前支持的功能有：
- 支持设置Redis集群/单机部署模式
- 集成Prometheus Exporter的内置监控
- 使用pvc模板进行动态存储配置
- k8s请求和限制的资源限制
- 密码/无密码设置
- 节点选择器和关联设置
- 优先级设置
- SecurityContext操作内核参数

## 2. rabbitmq

### 2.1 简介

> RabbitMQ是一个遵循AMQP协议的消息中间件，它从生产者接收消息并递送给消费者，
> 在这个过程中，根据规则进行路由，缓存与持久化。MQ全称为Message Queue, 消息队列（MQ）是一种应用程序对应用程序的通信方法。
> 应用程序通过读写出入队列的消息（针对应用程序的数据）来通信，而无需专用连接来链接它们。

### 2.2 集群部署方案

#### 2.2.1 普通模式

<img src="/img/posts/2021-04-02/rabbitmq_common.png"/>

普通模式是默认模式，对于队列来说，消息实体只存在于其中一个节点rabbit1或rabbit2，
rabbit1和rabbit2两个节点仅有相同的元数据，即队列的结构；
当消息进入rabbit1节点的队列后，消费者从rabbit2节点消费时，RabbitMQ会临时在rabbit01、rabbit02间进行消息传输，
从rabbit1队列中取出放入rabbit2队列中

#### 2.2.2 镜像模式

<img src="/img/posts/2021-04-02/rabbitmq_mirror.png"/>

镜像模式把需要的队列做成镜像队列，消息会在节点队列之间同步，属于rabbitmq集群HA的方案。
镜像模式的集群也是在普通模式的基础上，通过policy来实现；该模式除了降低系统性能外，如果镜像队列数量过多，占用带宽。

## 3. mariadb

### 3.1 简介

引用来自[https://zh.wikipedia.org/wiki/MariaDB](https://zh.wikipedia.org/wiki/MariaDB)
> MariaDB是MySQL关系数据库管理系统的一个复刻，由社区开发，有商业支持，旨在继续保持在GNU GPL下开源。
> MariaDB的开发是由MySQL的一些原始开发者领导的，他们担心甲骨文公司收购MySQL后会有一些隐患。
> MariaDB打算保持与MySQL的高度兼容性，确保具有库二进制奇偶校验的直接替换功能，
> 以及与MySQL API和命令的精确匹配。MariaDB自带了一个新的存储引擎Aria，它可以替代MyISAM，成为默认的事务和非事务引擎。
> 它最初使用XtraDB作为默认存储引擎，并从10.2版本切换回InnoDB。

### 3.2 集群部署方案

#### 3.2.1 主从半同步复制

<img src="/img/posts/2021-04-02/mariadb_replication.png"/>

使用双节点数据库，搭建单向或者双向的半同步复制；结合Haproxy、keepalived同时使用，
可以用来监控数据库的健康，当主库宕机，自动切换到备库继续工作。

#### 3.2.2 Galera多主同步复制

Galera的MySQL高可用集群， 是多主数据同步的MySQL集群解决方案；

<img src="/img/posts/2021-04-02/mariadb_galera.png"/>

Galera集群具有以下特点：
- 多主架构：真正的多主多活群集，可随时对任何节点进行读写。
- 同步复制：集群不同节点之间数据同步，某节点崩溃时没有数据丢失。
- 数据一致：所有节点保持相同状态，节点之间无数据分歧。
- 并行复制：重放支持多线程并行执行以获得更好的性能。
- 故障转移：故障节点本身对集群的影响非常小，某节点出现问题时无需切换操作，因此不需要使用VIP，也不会中断服务。
- 自动克隆：新增节点会自动拉取在线节点的数据，最终集群所有节点数据一致，而不需要手动备份恢复。
- 应用透明：提供透明的客户端访问，不需要对应用程序进行更改。

## 4. zookeeper

### 4.1 简介

> ZooKeeper是一个高性能、高可靠的分布式系统，是google chubby的一个开源实现。
> ZooKeeper是用于维护配置信息，命名，提供分布式同步和提供组服务的集中式服务。
> 一个ZooKeeper集群是奇数个节点组成，一般3～5个节点就可以组成一个集群。

### 4.2 集群部署方案

#### 4.2.1 集群模式
<img src="/img/posts/2021-04-02/zookeeper_cluster.png"/>

- Leader: zookeeper集群的核心，负责处理客户端的读写请求，以及集群内部服务的调度。（只有leader节点可以处理写请求）
- Follower: 负责处理客户端的读请求，把写请求转发给leader节点，参与leader节点选举的投票
- Observer: 3.3.0版本引进的一个新概念，Observer跟follower工作职责基本一致，observer也处理客户端的读请求，把写请求转发给leader节点。
但是Observer不参与任何选举，引进这个新概念的目的是解决大规模场景下减轻follower节点选举投票成本，避免集群性能下降

## 5. nacos

### 5.1 简介

> Nacos是阿里开源的一个项目，Nacos 致力于帮助您发现、配置和管理微服务。
> Nacos提供了一组简单易用的特性集，帮助您快速实现动态服务发现、服务配置、服务元数据及流量管理。
> Nacos帮助您更敏捷和容易地构建、交付和管理微服务平台。
> Nacos是构建以"服务"为中心的现代应用架构 (例如微服务范式、云原生范式) 的服务基础设施。

### 5.2 集群部署方案

#### 5.2.1 集群模式

推荐用户把所有服务列表放到一个vip下面，然后挂到一个域名下面

<img src="/img/posts/2021-04-02/nacos_cluster.png"/>

形如http://nacos.com:port/openAPI，域名+SLB模式(内网SLB，不可暴露到公网，以免带来安全风险)，可读性好，而且换ip方便，推荐模式。
数据源使用MySQL数据库，生产使用高可用数据库。

## 6. seata

### 6.1 简介

> Seata 是一款开源的分布式事务解决方案，致力于提供高性能和简单易用的分布式事务服务。
> Seata 将为用户提供了AT、TCC、SAGA 和XA 事务模式，为用户打造一站式的分布式解决方案。

### 6.2 集群部署方案

#### 6.2.1 集群TC Server

部署集群 Seata TC Server，实现高可用，生产环境下必备; 集群模式下多个Seata TC Server通过db数据库(MySQL)，实现全局事务会话信息的共享。
每个 Seata TC Server 可以注册自己到注册中心(Nacos)上，方便应用从注册中心获得到他们。

<img src="/img/posts/2021-04-02/seata_cluster.png"/>

## 参考链接

- [https://artifacthub.io/](https://artifacthub.io/)
- [https://github.com/OT-CONTAINER-KIT/redis-operator](https://github.com/OT-CONTAINER-KIT/redis-operator)
- [五大常见的MySQL高可用方案](https://zhuanlan.zhihu.com/p/25960208)
- [一文了解 Zookeeper 基本原理与应用场景](https://zhuanlan.zhihu.com/p/110617703)
- [Nacos文档](https://nacos.io/zh-cn/docs/what-is-nacos.html)
- [Seata文档](https://seata.io/zh-cn/docs/overview/what-is-seata.html)
