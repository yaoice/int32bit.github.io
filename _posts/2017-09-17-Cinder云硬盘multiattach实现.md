---
layout: post
title: Cinder云硬盘multiattach实践
subtitle: ""
catalog: true
tags:
     - OpenStack
---

## 背景

想通过Cinder multiattach功能，把一个卷挂载个多个虚拟机，从而实现数据共享。虽然我知道manila也可以做到，manila共享出来的是文件系统，而cinder共享出来的是块设备，第一次还需要格式化成文件系统。这里纯碎进行cinder multiattach实践分析。


### 环境

CentOS 7.1 （OpenStack Kilo）


### 步骤

#### 创建云硬盘

创建一块云硬盘带有multiattach属性，由于本地的cinderclient还不支持multiattach属性，所以直接调用api来创建了.


    curl -g -i -X POST \
       -H "User-Agent: python-cinderclient" \
       -H "Content-Type: application/json" \
       -H "Accept: application/json" \
       -H "X-Auth-Token: d9a747e29d8749e6ad9036448f62681e" \
       -d '{"volume":
              {"status": "creating",
               "description": null,
               "availability_zone": null,
               "source_volid":null,
               "consistencygroup_id": null,
               "snapshot_id": null,
               "source_replica":null,
               "size": 1,
               "user_id": null,
               "name": "test3",
               "multiattach": 1,
               "imageRef": null,
               "attach_status": "detached",
               "volume_type": null,
               "project_id": null,
               "metadata": {}
               }
            }' \
          http://192.168.114.133:8776/v2/a7d6b3e2c63647c4ac8553dfa88e2b1a/volumes

#### 挂载给多个虚拟机

挂载云硬盘给虚拟机，这里列出部分关键阶段：

    1. volume_api.check_attach -> nova/volume/cinder.py check_attach

    2. volume_api.reserve_volume -> nova/volume/cinder.py reserve_volume
       -> cinder/api/contrib/volume_actions.py _reserve
       -> cinder/volume/api.py reserve_volume

    3. compute_rpcapi.attach_volume -> nova/compute/rpcapi.py attach_volume
       -> nova/compute/manager.py _ComputeV4Proxy attach_volume
       -> nova/compute/manager.py ComputeManager attach_volume
       -> nova/compute/manager.py ComputeManager _attach_volume
       -> nova/virt/block_device.py DriverVolumeBlockDevice attach


结果是无法挂载给多个虚拟机，nova/volume/cinder.py中的check_attach就限制了，并没有针对volume的multiattach进行处理


    def check_attach(self, context, volume, instance=None):
       # TODO(vish): abstract status checking?
       if volume['status'] != "available":
           msg = _("volume '%(vol)s' status must be 'available'. Currently "
                   "in '%(status)s'") % {'vol': volume['id'],
                                         'status': volume['status']}
           raise exception.InvalidVolume(reason=msg)
       if volume['attach_status'] == "attached":
           msg = _("volume %s already attached") % volume['id']
           raise exception.InvalidVolume(reason=msg)


判断volume如果是multiattach属性，会把volume状态置为attaching

    def reserve_volume(self, context, volume):
       # NOTE(jdg): check for Race condition bug 1096983
       # explicitly get updated ref and check
       volume = self.db.volume_get(context, volume['id'])
       if volume['status'] == 'available':
           self.update(context, volume, {"status": "attaching"})
       elif volume['status'] == 'in-use':
           if volume['multiattach']:
               self.update(context, volume, {"status": "attaching"})
           else:
               msg = _("Volume must be multiattachable to reserve again.")
               LOG.error(msg)
               raise exception.InvalidVolume(reason=msg)
       else:
           msg = _("Volume status must be available to reserve.")
           LOG.error(msg)
           raise exception.InvalidVolume(reason=msg)           

也不会通知到cinder更新volume状态


    def attach(self, context, instance, volume_api, virt_driver,
              do_check_attach=True, do_driver_attach=False):

        。。。。。。

       if do_driver_attach:
           encryption = encryptors.get_encryption_metadata(
               context, volume_api, volume_id, connection_info)

           try:
               virt_driver.attach_volume(
                       context, connection_info, instance,
                       self['mount_device'], disk_bus=self['disk_bus'],
                       device_type=self['device_type'], encryption=encryption)
           except Exception:
               with excutils.save_and_reraise_exception():
                   LOG.exception(_LE("Driver failed to attach volume "
                                     "%(volume_id)s at %(mountpoint)s"),
                                 {'volume_id': volume_id,
                                  'mountpoint': self['mount_device']},
                                 context=context, instance=instance)
                   volume_api.terminate_connection(context, volume_id,
                                                   connector)
       self['connection_info'] = connection_info

       mode = 'rw'
       if 'data' in connection_info:
           mode = connection_info['data'].get('access_mode', 'rw')
       if volume['attach_status'] == "detached":    # 这个判断不符合
           # NOTE(mriedem): save our current state so connection_info is in
           # the database before the volume status goes to 'in-use' because
           # after that we can detach and connection_info is required for
           # detach.
           self.save()
           volume_api.attach(context, volume_id, instance.uuid,
                             self['mount_device'], mode=mode)  # 不通知cinder更新volume状态


### 展望

OpenStack社区从Ocata版本开始开发新的volume attach API，新设计的API将更好的实现多挂载(multi-attach)以及更好地解决cinder和nova状态不一致问题。

### 参考链接

- [http://int32bit.me/2017/09/08/OpenStack%E8%99%9A%E6%8B%9F%E6%9C%BA%E6%8C%82%E8%BD%BD%E6%95%B0%E6%8D%AE%E5%8D%B7%E8%BF%87%E7%A8%8B%E5%88%86%E6%9E%90/](http://int32bit.me/2017/09/08/OpenStack%E8%99%9A%E6%8B%9F%E6%9C%BA%E6%8C%82%E8%BD%BD%E6%95%B0%E6%8D%AE%E5%8D%B7%E8%BF%87%E7%A8%8B%E5%88%86%E6%9E%90/)
