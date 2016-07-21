# Ceph和Swift对比及场景分析

我们知道Ceph和Swift都能提供对象存储服务，对象存储服务类似我们经常使用的云网盘，能够支持上传文件、下载文件，并且支持高可靠的存储。二者具有相同的功能，那我们在实际部署时，如何考虑呢？这其实并没有绝对的答案，二者均各有优势，各有适合的场景，在组件选型时应该充分考虑部署环境，比如规模大小、延迟要求、是否跨域等。接下来本文将主要对比Swift和Ceph的主要差别。

## Swift

Swift最初是由Rackspace公司开发的高可用分布式对象存储服务，并于2010年贡献给OpenStack开源社区成为其核心子项目之一，截至2016年已有6年的历史，已经通过了大量的企业实例验证，并证明其已经能够适合在企业级大规模的生产部署。

它除了能够直接为用户提供对象存储服务，还与其他多个子项目集成，比如能够为Nova提供镜像存储、Sahara提供数据源存储、Cinder卷备份以及Trove备份等。它通过在软件层面引入一致性散列技术和数据冗余性，牺牲一定程度的数据一致性来达到高可用性和可伸缩性，支持多租户模式、容器和对象读写操作，适合大规模的应用场景下非结构化数据存储。

Swift主要缺陷是传输速率较慢和延迟大，主要原因是因为数据传输通信时必须经过代理服务器（the traffic to and from the Swift cluster flows through the proxy servers）。所谓延迟就是说用户更新数据后，并不保证能同时更新到所有的副本，立即对数据读也就意味着不一定能够读取最新数据，可能返回的还是旧版本数据。这是因为Swift在设计时使用的是最终一致性模型（Ceph使用的是强一致性模型）。另外有人认为Swift不如Ceph的理由是Swift不支持块存储以及文件系统存储。

## Ceph

在2004年，Sage Weil开发了一个名叫Ceph的开源项目，并于2006年，基于开源协议开源了Ceph。Weil 曾经是“Inktank Storage”公司的创始人。Inktank Storage一直专注于Ceph的研发，直到它被红帽收购。2012年，Ceph的第一个稳定版本发布了。2014年10月，Ceph的开发团队发布了Ceph的第七个稳定版本Giant。为了让Ceph更加成熟与完美，这个项目还在继续开发中。

Ceph, on the other hand, has its own set of issues, especially in a cloud context. Its multi-region support, while often cited as an advantage, is also a master-slave model. With replication possible only from master to slave, you see uneven load distribution in an infrastructure that covers more than two regions.

Ceph’s two-region design is also impractical as writes are only supported on the master, with no provision to block writes on the slave. In a worst case scenario, such a configuration can corrupt the cluster.

Another drawback to Ceph is security. RADOS clients on cloud compute nodes communicate directly with the RADOS servers over the same network Ceph uses for unencrypted replication traffic. If a Ceph client node gets compromised, an attacker could observe traffic on the storage network.