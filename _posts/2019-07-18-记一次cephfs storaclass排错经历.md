---
layout: post
title: 记一次cephfs storageclass排错经历
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

- OS: CentOS 7.5
- Kubernetes v1.11.6
- Etcd 3.3.10
- Docker 1.13.1
- Ceph 13.2.2
- python-cephfs 13.2.1
- libcephfs2 13.2.1

### CephFS Storageclass

这里采用的是[https://github.com/kubernetes-incubator/external-storage/tree/master/ceph/cephfs](https://github.com/kubernetes-incubator/external-storage/tree/master/ceph/cephfs)

虽然k8s官方代码库中已有cephfs volume实现，不过不是dynamic pv的实现
[https://github.com/kubernetes/kubernetes/pkg/volume/cephfs/cephfs.go](https://github.com/kubernetes/kubernetes/pkg/volume/cephfs/cephfs.go)

官方一直推荐out-of-tree的存储插件方式，比如ceph csi, 要求k8s版本至少v13.0.0

<img src="/img/posts/2019-07-18/1.png" width="800" height="600" />

暂时还是用external-storage中的cephfs

### External-Storage cephfs实现

核心文件cephfs-provisioner.go和cephfs_provisioner.py

- cephfs-provisioner.go 

  实现了Provisioner接口定义的Provision方法和Delete方法
  
  Provisioner接口定义: [github.com/kubernetes-sigs/sig-storage-lib-external-provisioner/controller](github.com/kubernetes-sigs/sig-storage-lib-external-provisioner/controller)

  pc.Run(wait.NeverStop) 启动sig-storage-lib-external-provisioner/controller中定义的控制器，包含三种informer, 分别是：
  
  - claimInformer
  - volumeInformer
  - classInformer

- cephfs_provisioner.py

  cephfs-provisioner.go中的Provision方法和Delete方法最终调用cephfs_provisioner.py来实现，cephfs创建和删除.
  
总体来说，代码量不多，就两个文件

### 调试

本地IDE调试的时候，会遇到报错，由于klog和glog中的log_dir变量重复定义

注释cephfs-provisioner.go中的如下代码，暂时跳过
```
//	klog.InitFlags(nil)
```

在Provision方法处，144~162行处，把真正创建cephfs命令打印出来

```
cmd := exec.Command(provisionCmd, args...)
fmt.Println("xxxxxxxxx")
fmt.Println(args)
```
```
fmt.Println("!!!!!!!!!!!")
fmt.Println(cmd.Env)
output, cmdErr := cmd.CombinedOutput()
```

进入cephfs-provisioner的pod中
```
kubectl -n cephfs exec -it cephfs-provisioner-5b698887f5-vf2fl sh
```

对cephfs_provisioner python脚本就可以设置pdb调试了
```
CEPH_CLUSTER_NAME=ceph CEPH_MON=9.30.9.198:6790 \
    CEPH_AUTH_ID=admin CEPH_AUTH_KEY=AQDq3yVdo+o1DxAAIJ5nsCLpq7w7D992D6oXxg== \
    CEPH_VOLUME_ROOT=/volumes/kubernetes \
    cephfs_provisioner -n kubernetes-dynamic-pvc-46f2c36c-a8fd-11e9-9f5c-88e9fe804968 \
    -u kubernetes-dynamic-user-46f2c3bc-a8fd-11e9-9f5c-88e9fe804968
```

### 参考链接

- [https://github.com/ceph/ceph-csi](https://github.com/ceph/ceph-csi)
- [https://github.com/kubernetes-incubator/external-storage/tree/master/ceph/cephfs](https://github.com/kubernetes-incubator/external-storage/tree/master/ceph/cephfs)