---
layout: post
title: K8s HPA
subtitle: 常用指标及自定义指标实现
catalog: true
tags:
     - k8s
---

### 常用指标

通过配置prometheus rules进行聚合运算，得出常用指标
```
[root@ice ~]# kubectl -n kube-system get cm prometheus-k8s-rulefiles-0 -o yaml
apiVersion: v1
data:
  kube-system-prometheus-alerts.yaml: |
    {}
  kube-system-prometheus-records.yaml: |
    groups:
    - name: k8s-ag-data
      rules:
      - expr: kubelet_running_pod_count*0 + 1
        record: kube_node_labels
      - expr: sum by(node) (kube_node_status_capacity{resource="tencent_com_vcuda_core"})
        record: kube_node_status_capacity_gpu
      - expr: sum by(node) (kube_node_status_capacity{resource="tencent_com_vcuda_memory"})
        record: kube_node_status_capacity_gpu_memory
      - expr: sum by(node) (kube_node_status_allocatable{resource="tencent_com_vcuda_core"})
        record: kube_node_status_allocatable_gpu
      - expr: sum by(node) (kube_node_status_allocatable{resource="tencent_com_vcuda_memory"})
        record: kube_node_status_allocatable_gpu_memory
      - expr: kube_pod_info* on(node) group_left(node_role) kube_node_labels
        record: __pod_info1
      - expr: label_replace(label_replace(__pod_info1{workload_kind="ReplicaSet"} * on
          (workload_name,namespace) group_left(owner_name, owner_kind) label_replace(kube_replicaset_owner,"workload_name","$1","replicaset","(.*)"),"workload_name","$1","owner_name","(.*)"),"workload_kind","$1","owner_kind","(.*)")  or
          on(pod_name,namesapce)  __pod_info1{workload_kind != "ReplicaSet"}
        record: __pod_info2
      - expr: sum(kube_node_status_allocatable_cpu_cores * on(node) group_left kube_node_labels
          {node_role="Node"})
        record: k8s_cluster_cpu_core_total
      - expr: sum(kube_node_status_allocatable_memory_bytes * on(node) group_left kube_node_labels
          {node_role="Node"})
        record: k8s_cluster_memory_total
      - expr: sum(kube_node_status_allocatable_gpu * on(node) group_left kube_node_labels
          {node_role="Node"})
        record: k8s_cluster_gpu_total
      - expr: sum(kube_node_status_allocatable_gpu_memory * on(node) group_left kube_node_labels
          {node_role="Node"})
        record: k8s_cluster_gpu_memory_total
      - expr: rate(container_cpu_usage_seconds_total[2m]) * on(namespace, pod_name) group_left(workload_kind,
          workload_name, node, node_role)  __pod_info2
        record: k8s_container_cpu_core_used
      - expr: k8s_container_cpu_core_used * 100 / on (pod_name,namespace,container_name)  group_left  kube_pod_container_resource_requests{resource="cpu"}
        record: k8s_container_rate_cpu_core_used_request
      - expr: k8s_container_cpu_core_used * 100 / on (pod_name,namespace,container_name)  group_left  kube_pod_container_resource_limits{resource="cpu"}
        record: k8s_container_rate_cpu_core_used_limit
      - expr: k8s_container_cpu_core_used * 100 / on(node) group_left  kube_node_status_capacity_cpu_cores
        record: k8s_container_rate_cpu_core_used_node
      - expr: container_memory_usage_bytes * on(namespace, pod_name) group_left(workload_kind,workload_name,node,
          node_role)  __pod_info2
        record: k8s_container_mem_usage_bytes
      - expr: (container_memory_usage_bytes -  container_memory_cache)  * on(namespace,
          pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_container_mem_no_cache_bytes
      - expr: k8s_container_mem_usage_bytes * 100 / on (pod_name,namespace,container_name)  group_left
          kube_pod_container_resource_requests{resource="memory"}
        record: k8s_container_rate_mem_usage_request
      - expr: k8s_container_mem_no_cache_bytes * 100 / on (pod_name,namespace,container_name)  group_left
          kube_pod_container_resource_requests{resource="memory"}
        record: k8s_container_rate_mem_no_cache_request
      - expr: k8s_container_mem_usage_bytes * 100 / on (pod_name,namespace,container_name)  group_left
          kube_pod_container_resource_limits{resource="memory"}
        record: k8s_container_rate_mem_usage_limit
      - expr: k8s_container_mem_no_cache_bytes * 100 / on (pod_name,namespace,container_name)  group_left
          kube_pod_container_resource_limits{resource="memory"}
        record: k8s_container_rate_mem_no_cache_limit
      - expr: k8s_container_mem_usage_bytes * 100 / on(node) group_left  kube_node_status_capacity_memory_bytes
        record: k8s_container_rate_mem_usage_node
      - expr: k8s_container_mem_no_cache_bytes * 100 / on(node) group_left  kube_node_status_capacity_memory_bytes
        record: k8s_container_rate_mem_no_cache_node
      - expr: container_gpu_utilization{gpu="total"} * on(namespace, pod_name) group_left(workload_kind,workload_name,node,
          node_role) __pod_info2
        record: k8s_container_gpu_used
      - expr: k8s_container_gpu_used / on (pod_name,namespace,container_name) group_left
          container_request_gpu_utilization
        record: k8s_container_rate_gpu_used_request
      - expr: k8s_container_gpu_used * 100 / on(node) group_left kube_node_status_capacity_gpu
        record: k8s_container_rate_gpu_used_node
      - expr: container_gpu_memory_total{gpu_memory="total"} / 256 * on(namespace, pod_name)
          group_left(workload_kind,workload_name,node, node_role) __pod_info2
        record: k8s_container_gpu_memory_used
      - expr: k8s_container_gpu_memory_used * 100 / on (pod_name,namespace,container_name)
          group_left() (container_request_gpu_memory / 256)
        record: k8s_container_rate_gpu_memory_used_request
      - expr: k8s_container_gpu_memory_used * 100 / on(node) group_left() kube_node_status_capacity_gpu_memory
        record: k8s_container_rate_gpu_memory_used_node
      - expr: sum(rate(container_network_receive_bytes_total[2m])) without(interface)  *
          on(namespace, pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_container_network_receive_bytes_bw
      - expr: sum(rate(container_network_transmit_bytes_total[2m])) without(interface)  *
          on(namespace, pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_container_network_transmit_bytes_bw
      - expr: sum(idelta(container_network_receive_bytes_total[2m])) without(interface)  *
          on(namespace, pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_container_network_receive_bytes
      - expr: sum(idelta(container_network_transmit_bytes_total[2m])) without(interface)  *
          on(namespace, pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_container_network_transmit_bytes
      - expr: sum(rate(container_network_receive_packets_total[2m])) without(interface)  *
          on(namespace, pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_container_network_receive_packets
      - expr: sum(rate(container_network_transmit_packets_total[2m])) without(interface)  *
          on(namespace, pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_container_network_transmit_packets
      - expr: sum(rate(container_fs_reads_bytes_total[2m])) without(device)  * on(namespace,
          pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_container_fs_read_bytes
      - expr: sum(rate(container_fs_writes_bytes_total[2m])) without(device)  * on(namespace,
          pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_container_fs_write_bytes
      - expr: sum(rate(container_fs_reads_total[2m])) without(device)  * on(namespace,
          pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_container_fs_read_times
      - expr: sum(rate(container_fs_writes_total[2m])) without(device)  * on(namespace,
          pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_container_fs_write_times
      - expr: sum(k8s_container_cpu_core_used) without (container_name,container_id)
        record: k8s_pod_cpu_core_used
      - expr: sum(k8s_container_cpu_core_used + on (container_name, pod_name, namespace)
          group_left kube_pod_container_resource_requests{resource="cpu"} * 0) without(container_name
          )   * 100  / on (pod_name,namespace)  group_left  sum(kube_pod_container_resource_requests{resource="cpu"})  without(container_name)
        record: k8s_pod_rate_cpu_core_used_request
      - expr: sum(k8s_container_cpu_core_used + on (container_name, pod_name, namespace)
          group_left kube_pod_container_resource_limits{resource="cpu"} * 0) without(container_name
          )   * 100  / on (pod_name,namespace)  group_left  sum(kube_pod_container_resource_limits{resource="cpu"})  without(container_name)
        record: k8s_pod_rate_cpu_core_used_limit
      - expr: k8s_pod_cpu_core_used *100 /  on(node) group_left  kube_node_status_capacity_cpu_cores
        record: k8s_pod_rate_cpu_core_used_node
      - expr: sum(k8s_container_mem_usage_bytes) without (container_name,container_id)
        record: k8s_pod_mem_usage_bytes
      - expr: sum(k8s_container_mem_no_cache_bytes) without (container_name,container_id)
        record: k8s_pod_mem_no_cache_bytes
      - expr: sum(k8s_container_mem_usage_bytes + on (container_name, pod_name, namespace)
          group_left kube_pod_container_resource_requests{resource="memory"} * 0) without(container_name
          )   * 100    / on (pod_name,namespace)  group_left  sum(kube_pod_container_resource_requests{resource="memory"})
          without(container_name)
        record: k8s_pod_rate_mem_usage_request
      - expr: sum(k8s_container_mem_no_cache_bytes + on (container_name, pod_name, namespace)
          group_left kube_pod_container_resource_requests{resource="memory"} * 0) without(container_name
          )   * 100    / on (pod_name,namespace)  group_left  sum(kube_pod_container_resource_requests{resource="memory"})
          without(container_name)
        record: k8s_pod_rate_mem_no_cache_request
      - expr: sum(k8s_container_mem_usage_bytes + on (container_name, pod_name, namespace)
          group_left kube_pod_container_resource_limits{resource="memory"} * 0) without(container_name
          )   * 100    / on (pod_name,namespace)  group_left  sum(kube_pod_container_resource_limits{resource="memory"})  without(container_name)
        record: k8s_pod_rate_mem_usage_limit
      - expr: sum(k8s_container_mem_no_cache_bytes + on (container_name, pod_name, namespace)
          group_left kube_pod_container_resource_limits{resource="memory"} * 0) without(container_name
          )   * 100    / on (pod_name,namespace)  group_left  sum(kube_pod_container_resource_limits{resource="memory"})  without(container_name)
        record: k8s_pod_rate_mem_no_cache_limit
      - expr: k8s_pod_mem_usage_bytes * 100  /  on(node) group_left  kube_node_status_capacity_memory_bytes
        record: k8s_pod_rate_mem_usage_node
      - expr: k8s_pod_mem_no_cache_bytes * 100 / on(node) group_left  kube_node_status_capacity_memory_bytes
        record: k8s_pod_rate_mem_no_cache_node
      - expr: sum(k8s_container_gpu_used) without (container_name,container_id)
        record: k8s_pod_gpu_used
      - expr: sum(container_request_gpu_utilization * 100) without(container_name)
        record: k8s_pod_gpu_request
      - expr: sum(k8s_container_gpu_used + on (container_name, pod_name, namespace) group_left
          container_request_gpu_utilization * 0) without(container_name) * 100 / on (pod_name,namespace)
          group_left k8s_pod_gpu_request
        record: k8s_pod_rate_gpu_used_request
      - expr: k8s_pod_gpu_used * 100  /  on(node) group_left  kube_node_status_capacity_gpu
        record: k8s_pod_rate_gpu_used_node
      - expr: sum(k8s_container_gpu_memory_used) without (container_name,container_id)
        record: k8s_pod_gpu_memory_used
      - expr: sum(container_request_gpu_memory / 256)  without(container_name)
        record: k8s_pod_gpu_memory_request
      - expr: sum(k8s_container_gpu_memory_used + on (container_name, pod_name, namespace)
          group_left container_request_gpu_memory * 0) without(container_name) * 100  /
          on (pod_name,namespace) group_left k8s_pod_gpu_memory_request
        record: k8s_pod_rate_gpu_memory_used_request
      - expr: k8s_pod_gpu_memory_used * 100  /  on(node) group_left() kube_node_status_capacity_gpu_memory
        record: k8s_pod_rate_gpu_memory_used_node
      - expr: sum(k8s_container_network_receive_bytes_bw) without (container_name,container_id)
        record: k8s_pod_network_receive_bytes_bw
      - expr: sum(k8s_container_network_transmit_bytes_bw) without (container_name,container_id)
        record: k8s_pod_network_transmit_bytes_bw
      - expr: sum(k8s_container_network_receive_bytes) without (container_name,container_id)
        record: k8s_pod_network_receive_bytes
      - expr: sum(k8s_container_network_transmit_bytes) without (container_name,container_id)
        record: k8s_pod_network_transmit_bytes
      - expr: sum(k8s_container_network_receive_packets) without (container_name,container_id)
        record: k8s_pod_network_receive_packets
      - expr: sum(k8s_container_network_transmit_packets) without (container_name,container_id)
        record: k8s_pod_network_transmit_packets
      - expr: sum(k8s_container_fs_read_bytes) without (container_name,container_id)
        record: k8s_pod_fs_read_bytes
      - expr: sum(k8s_container_fs_write_bytes) without (container_name,container_id)
        record: k8s_pod_fs_write_bytes
      - expr: sum(k8s_container_fs_read_times) without (container_name,container_id)
        record: k8s_pod_fs_read_times
      - expr: sum(k8s_container_fs_write_times) without (container_name,container_id)
        record: k8s_pod_fs_write_times
      - expr: sum(kube_pod_status_ready{condition="true"}) by (namespace,pod_name) *  on(namespace,
          pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_pod_status_ready
      - expr: sum(idelta(kube_pod_container_status_restarts_total [2m])) by (namespace,pod_name)
          *  on(namespace, pod_name) group_left(workload_kind,workload_name,node, node_role)  __pod_info2
        record: k8s_pod_restart_total
      - expr: max(kube_node_status_condition{condition="Ready", status="true"} * on (node)
          group_left(node_role)  kube_node_labels)  without(condition, status)
        record: k8s_node_status_ready
      - expr: sum(k8s_pod_restart_total) without (pod_name,workload_kind,workload_name,namespace)
        record: k8s_node_pod_restart_total
      - expr: sum(k8s_pod_cpu_core_used) without(namespace,pod_name,workload_kind,workload_name)
          *100 / on(node) group_left kube_node_status_capacity_cpu_cores
        record: k8s_node_cpu_usage
      - expr: sum(k8s_pod_mem_usage_bytes) without(namespace,pod_name,workload_kind,workload_name)
          *100 / on(node) group_left kube_node_status_capacity_memory_bytes
        record: k8s_node_mem_usage
      - expr: sum(k8s_pod_gpu_used) without(namespace,pod_name,workload_kind,workload_name)
          *100 / on(node) group_left kube_node_status_capacity_gpu
        record: k8s_node_gpu_usage
      - expr: sum(k8s_pod_gpu_memory_used) without(namespace,pod_name,workload_kind,workload_name)
          *100 / on(node) group_left() kube_node_status_capacity_gpu_memory
        record: k8s_node_gpu_memory_usage
      - expr: (sum by (node) (irate(node_disk_written_bytes_total[2m]))) *on(node) group_left(node_role)
          kube_node_labels
        record: k8s_node_fs_write_bytes
      - expr: (sum by (node) (irate(node_disk_read_bytes_total[2m])))*on(node) group_left(node_role)
          kube_node_labels
        record: k8s_node_fs_read_bytes
      - expr: (sum by (node) (irate(node_disk_writes_completed_total[2m])))*on(node) group_left(node_role)
          kube_node_labels
        record: k8s_node_fs_write_times
      - expr: (sum by (node) (irate(node_disk_reads_completed_total[2m])))*on(node) group_left(node_role)
          kube_node_labels
        record: k8s_node_fs_read_times
      - expr: count(k8s_pod_status_ready) without (pod_name,workload_kind,workload_name,namespace)
        record: k8s_node_pod_num
      - expr: (100 - sum (node_filesystem_avail_bytes{fstype=~"ext3|ext4|xfs"}) by (node)
          / sum (node_filesystem_size_bytes{fstype=~"ext3|ext4|xfs"}) by (node) *100)
          *on(node) group_left(node_role) kube_node_labels
        record: k8s_node_disk_space_rate
      - expr: (sum by (node) (irate(node_network_receive_bytes_total{device!~"lo|veth(.*)|virb(.*)|docker(.*)|tunl(.*)|v-h(.*)|flannel(.*)"}[5m])))*on(node)
          group_left(node_role) kube_node_labels
        record: k8s_node_network_receive_bytes_bw
      - expr: (sum by (node) (irate(node_network_transmit_bytes_total{device!~"lo|veth(.*)|virb(.*)|docker(.*)|tunl(.*)|v-h(.*)|flannel(.*)"}[5m])))*on(node)
          group_left(node_role) kube_node_labels
        record: k8s_node_network_transmit_bytes_bw
      - expr: |-
          max(label_replace(
          label_replace(
          label_replace(
          kube_deployment_status_replicas_unavailable,
          "workload_kind","Deployment","","")
          ,"workload_name","$1","deployment","(.*)"),
          "__name__", "k8s_workload_abnormal", "__name__","(.*)") ) by (namespace, workload_name, workload_kind,__name__)
          or on (namespace,workload_name,workload_kind, __name__)
          max(label_replace(
          label_replace(
          label_replace(
          kube_daemonset_status_number_unavailable,
          "workload_kind","DaemonSet","","")
          ,"workload_name","$1","daemonset","(.*)"),
          "__name__", "k8s_workload_abnormal", "__name__","(.*)") ) by (namespace, workload_name, workload_kind,__name__)
          or on (namespace,workload_name,workload_kind, __name__)
          max(label_replace(
          label_replace(
          label_replace(
          (kube_statefulset_replicas - kube_statefulset_status_replicas_ready),
          "workload_kind","StatefulSet","","")
          ,"workload_name","$1","statefulset","(.*)"),
          "__name__", "k8s_workload_abnormal", "__name__","(.*)") ) by (namespace, workload_name, workload_kind,__name__)
          or on (namespace,workload_name,workload_kind, __name__)
          max(label_replace(
          label_replace(
          label_replace(
          (kube_job_status_failed),
          "workload_kind","Job","","")
          ,"workload_name","$1","job_name","(.*)"),
          "__name__", "k8s_workload_abnormal", "__name__","(.*)") ) by (namespace, workload_name, workload_kind,__name__)
          or on (namespace,workload_name,workload_kind, __name__)
          max(label_replace(
          label_replace(
          label_replace(
          (kube_cronjob_info * 0),
          "workload_kind","CronJob","","")
          ,"workload_name","","cronjob","(.*)"),
          "__name__", "k8s_workload_abnormal", "__name__","(.*)") ) by (namespace, workload_name, workload_kind,__name__)
        record: k8s_workload_abnormal
      - expr: sum(k8s_pod_restart_total) by(namespace,workload_kind,workload_name)
        record: k8s_workload_pod_restart_total
      - expr: sum(k8s_pod_cpu_core_used) by(workload_name, workload_kind, namespace)
        record: k8s_workload_cpu_core_used
      - expr: k8s_workload_cpu_core_used * 100 / scalar(k8s_cluster_cpu_core_total)
        record: k8s_workload_rate_cpu_core_used_cluster
      - expr: sum(k8s_pod_mem_usage_bytes) by(workload_name, workload_kind, namespace)
        record: k8s_workload_mem_usage_bytes
      - expr: sum(k8s_pod_mem_no_cache_bytes) by(workload_name, workload_kind, namespace)
        record: k8s_workload_mem_no_cache_bytes
      - expr: k8s_workload_mem_usage_bytes  * 100 / scalar(k8s_cluster_memory_total)
        record: k8s_workload_rate_mem_usage_bytes_cluster
      - expr: k8s_workload_mem_no_cache_bytes * 100 / scalar(k8s_cluster_memory_total)
        record: k8s_workload_rate_mem_no_cache_cluster
      - expr: sum(k8s_pod_network_receive_bytes_bw) by(workload_name, workload_kind, namespace)
        record: k8s_workload_network_receive_bytes_bw
      - expr: sum(k8s_pod_network_transmit_bytes_bw)  by(workload_name, workload_kind,
          namespace)
        record: k8s_workload_network_transmit_bytes_bw
      - expr: sum(k8s_pod_network_receive_bytes)  by(workload_name, workload_kind, namespace)
        record: k8s_workload_network_receive_bytes
      - expr: sum(k8s_pod_network_transmit_bytes) by(workload_name, workload_kind, namespace)
        record: k8s_workload_network_transmit_bytes
      - expr: sum(k8s_pod_network_receive_packets)  by(workload_name, workload_kind, namespace)
        record: k8s_workload_network_receive_packets
      - expr: sum(k8s_pod_network_transmit_packets) by(workload_name, workload_kind, namespace)
        record: k8s_workload_network_transmit_packets
      - expr: sum(k8s_pod_fs_read_bytes) by (workload_name, workload_kind, namespace)
        record: k8s_workload_fs_read_bytes
      - expr: sum(k8s_pod_fs_write_bytes) by (workload_name, workload_kind, namespace)
        record: k8s_workload_fs_write_bytes
      - expr: sum(k8s_pod_fs_read_times) by (workload_name, workload_kind, namespace)
        record: k8s_workload_fs_read_times
      - expr: sum(k8s_pod_fs_write_times) by (workload_name, workload_kind, namespace)
        record: k8s_workload_fs_write_times
      - expr: sum(k8s_pod_gpu_used) by(workload_name, workload_kind, namespace)
        record: k8s_workload_gpu_used
      - expr: k8s_workload_gpu_used * 100 / scalar(k8s_cluster_gpu_total)
        record: k8s_workload_rate_gpu_used_cluster
      - expr: sum(k8s_pod_gpu_memory_used) by(workload_name, workload_kind, namespace)
        record: k8s_workload_gpu_memory_used
      - expr: k8s_workload_gpu_memory_used * 100 / scalar(k8s_cluster_gpu_memory_total)
        record: k8s_workload_rate_gpu_memory_used_cluster
      - expr: sum(k8s_pod_cpu_core_used) by (namespace)
        record: k8s_namespace_cpu_core_used
      - expr: k8s_namespace_cpu_core_used * 100 / scalar(k8s_cluster_cpu_core_total)
        record: k8s_namespace_rate_cpu_core_used_cluster
      - expr: sum(k8s_pod_mem_usage_bytes) by (namespace)
        record: k8s_namespace_mem_usage_bytes
      - expr: sum(k8s_pod_mem_no_cache_bytes) by (namespace)
        record: k8s_namespace_mem_no_cache_bytes
      - expr: k8s_namespace_mem_usage_bytes * 100 / scalar(k8s_cluster_memory_total)
        record: k8s_namespace_rate_mem_usage_bytes_cluster
      - expr: k8s_namespace_mem_no_cache_bytes * 100 / scalar(k8s_cluster_memory_total)
        record: k8s_namespace_rate_mem_no_cache_cluster
      - expr: sum(k8s_pod_network_receive_bytes_bw) by(namespace)
        record: k8s_namespace_network_receive_bytes_bw
      - expr: sum(k8s_pod_network_transmit_bytes_bw) by(namespace)
        record: k8s_namespace_network_transmit_bytes_bw
      - expr: sum(k8s_pod_network_receive_bytes) by(namespace)
        record: k8s_namespace_network_receive_bytes
      - expr: sum(k8s_pod_network_transmit_bytes) by(namespace)
        record: k8s_namespace_network_transmit_bytes
      - expr: sum(k8s_pod_network_receive_packets) by(namespace)
        record: k8s_namespace_network_receive_packets
      - expr: sum(k8s_pod_network_transmit_packets) by(namespace)
        record: k8s_namespace_network_transmit_packets
      - expr: sum(k8s_workload_fs_read_bytes) by (namespace)
        record: k8s_namespace_fs_read_bytes
      - expr: sum(k8s_workload_fs_write_bytes) by (namespace)
        record: k8s_namespace_fs_write_bytes
      - expr: sum(k8s_workload_fs_read_times) by (namespace)
        record: k8s_namespace_fs_read_times
      - expr: sum(k8s_workload_fs_write_times) by (namespace)
        record: k8s_namespace_fs_write_times
      - expr: sum(k8s_pod_gpu_used) by (namespace)
        record: k8s_namespace_gpu_used
      - expr: k8s_namespace_gpu_used * 100 / scalar(k8s_cluster_gpu_total)
        record: k8s_namespace_rate_gpu_used_cluster
      - expr: sum(k8s_pod_gpu_memory_used) by (namespace)
        record: k8s_namespace_gpu_memory_used
      - expr: k8s_namespace_gpu_memory_used * 100 / scalar(k8s_cluster_gpu_memory_total)
        record: k8s_namespace_rate_gpu_memory_used_cluster
      - expr: sum(k8s_pod_cpu_core_used{node_role="Node"})
        record: k8s_cluster_cpu_core_used
      - expr: sum(k8s_pod_mem_usage_bytes{node_role="Node"})
        record: k8s_cluster_mem_usage_bytes
      - expr: sum(k8s_pod_mem_no_cache_bytes{node_role="Node"})
        record: k8s_cluster_mem_no_cache_bytes
      - expr: k8s_cluster_cpu_core_used  * 100 / scalar(k8s_cluster_cpu_core_total)
        record: k8s_cluster_rate_cpu_core_used_cluster
      - expr: sum(kube_pod_container_resource_requests{resource="cpu"} * on(node) group_left
          kube_node_labels {node_role="Node"} ) * 100 / scalar(k8s_cluster_cpu_core_total)
        record: k8s_cluster_rate_cpu_core_request_cluster
      - expr: k8s_cluster_mem_usage_bytes * 100 / scalar(k8s_cluster_memory_total)
        record: k8s_cluster_rate_mem_usage_bytes_cluster
      - expr: k8s_cluster_mem_no_cache_bytes * 100 / scalar(k8s_cluster_memory_total)
        record: k8s_cluster_rate_mem_no_cache_bytes_cluster
      - expr: sum(kube_pod_container_resource_requests{resource="memory"} * on(node) group_left
          kube_node_labels {node_role="Node"} ) * 100 / scalar(k8s_cluster_memory_total)
        record: k8s_cluster_rate_mem_request_bytes_cluster
      - expr: sum(k8s_pod_network_receive_bytes_bw{node_role="Node"})
        record: k8s_cluster_network_receive_bytes_bw
      - expr: sum(k8s_pod_network_transmit_bytes_bw{node_role="Node"})
        record: k8s_cluster_network_transmit_bytes_bw
      - expr: sum(k8s_pod_network_receive_bytes{node_role="Node"})
        record: k8s_cluster_network_receive_bytes
      - expr: sum(k8s_pod_network_transmit_bytes{node_role="Node"})
        record: k8s_cluster_network_transmit_bytes
      - expr: sum(k8s_pod_network_receive_packets{node_role="Node"})
        record: k8s_cluster_network_receive_packets
      - expr: sum(k8s_pod_network_transmit_packets{node_role="Node"})
        record: k8s_cluster_network_transmit_packets
      - expr: sum(k8s_pod_fs_read_bytes{node_role="Node"})
        record: k8s_cluster_fs_read_bytes
      - expr: sum(k8s_pod_fs_write_bytes{node_role="Node"})
        record: k8s_cluster_fs_write_bytes
      - expr: sum(k8s_pod_fs_read_times{node_role="Node"})
        record: k8s_cluster_fs_read_times
      - expr: sum(k8s_pod_fs_write_times{node_role="Node"})
        record: k8s_cluster_fs_write_times
      - expr: sum(k8s_pod_gpu_used{node_role="Node"})
        record: k8s_cluster_gpu_used
      - expr: k8s_cluster_gpu_used  * 100 / scalar(k8s_cluster_gpu_total)
        record: k8s_cluster_rate_gpu_used_cluster
      - expr: sum(k8s_pod_gpu_request * on(node) group_left kube_node_labels {node_role="Node"})
          * 100 / scalar(k8s_cluster_gpu_total)
        record: k8s_cluster_rate_gpu_request_cluster
      - expr: sum(k8s_pod_gpu_memory_used{node_role="Node"})
        record: k8s_cluster_gpu_memory_used
      - expr: k8s_cluster_gpu_memory_used  * 100 / scalar(k8s_cluster_gpu_memory_total)
        record: k8s_cluster_rate_gpu_memory_used_cluster
      - expr: sum(k8s_pod_gpu_memory_request * on(node) group_left kube_node_labels {node_role="Node"}
          ) * 100 / scalar(k8s_cluster_gpu_memory_total)
        record: k8s_cluster_rate_gpu_memory_request_cluster
      - expr: k8s_namespace_cpu_core_used* on(namespace) group_left(project_name) kube_namespace_labels
        record: project_namespace_cpu_core_used
      - expr: k8s_namespace_mem_usage_bytes* on(namespace) group_left(project_name) kube_namespace_labels
        record: project_namespace_mem_usage_bytes
      - expr: k8s_namespace_mem_no_cache_bytes* on(namespace) group_left(project_name)
          kube_namespace_labels
        record: project_namespace_mem_no_cache_bytes
      - expr: k8s_namespace_gpu_used* on(namespace) group_left(project_name) kube_namespace_labels
        record: project_namespace_gpu_used
      - expr: k8s_namespace_gpu_memory_used* on(namespace) group_left(project_name) kube_namespace_labels
        record: project_namespace_gpu_memory_used
      - expr: k8s_namespace_network_receive_bytes_bw* on(namespace) group_left(project_name)
          kube_namespace_labels
        record: project_namespace_network_receive_bytes_bw
      - expr: k8s_namespace_network_transmit_bytes_bw* on(namespace) group_left(project_name)
          kube_namespace_labels
        record: project_namespace_network_transmit_bytes_bw
      - expr: k8s_namespace_network_receive_bytes* on(namespace) group_left(project_name)
          kube_namespace_labels
        record: project_namespace_network_receive_bytes
      - expr: k8s_namespace_network_transmit_bytes* on(namespace) group_left(project_name)
          kube_namespace_labels
        record: project_namespace_network_transmit_bytes
      - expr: k8s_namespace_fs_read_bytes* on(namespace) group_left(project_name) kube_namespace_labels
        record: project_namespace_fs_read_bytes
      - expr: k8s_namespace_fs_write_bytes* on(namespace) group_left(project_name) kube_namespace_labels
        record: project_namespace_fs_write_bytes
      - expr: sum(project_namespace_cpu_core_used) by (project_name)
        record: project_cluster_cpu_core_used
      - expr: project_cluster_cpu_core_used * 100 / scalar(k8s_cluster_cpu_core_total)
        record: project_cluster_rate_cpu_core_used_cluster
      - expr: sum(project_namespace_mem_usage_bytes) by (project_name)
        record: project_cluster_memory_usage_bytes
      - expr: sum(project_namespace_mem_no_cache_bytes) by (project_name)
        record: project_cluster_memory_no_cache_bytes
      - expr: project_cluster_memory_usage_bytes * 100 / scalar(k8s_cluster_memory_total)
        record: project_cluster_rate_memory_usage_bytes_cluster
      - expr: project_cluster_memory_no_cache_bytes * 100 / scalar(k8s_cluster_memory_total)
        record: project_cluster_rate_memory_no_cache_cluster
      - expr: sum(project_namespace_gpu_used) by (project_name)
        record: project_cluster_gpu_used
      - expr: project_cluster_gpu_used * 100 / scalar(k8s_cluster_gpu_total)
        record: project_cluster_rate_gpu_used_cluster
      - expr: sum(project_namespace_gpu_memory_used) by (project_name)
        record: project_cluster_gpu_memory_used
      - expr: project_cluster_gpu_memory_used * 100 / scalar(k8s_cluster_gpu_memory_total)
        record: project_cluster_rate_gpu_memory_used_cluster
      - expr: sum(project_namespace_network_receive_bytes_bw) by (project_name)
        record: project_cluster_network_receive_bytes_bw
      - expr: sum(project_namespace_network_transmit_bytes_bw) by (project_name)
        record: project_cluster_network_transmit_bytes_bw
      - expr: sum(project_namespace_network_receive_bytes) by (project_name)
        record: project_cluster_network_receive_bytes
      - expr: sum(project_namespace_network_transmit_bytes) by (project_name)
        record: project_cluster_network_transmit_bytes
      - expr: sum(project_namespace_fs_read_bytes) by (project_name)
        record: project_cluster_fs_read_bytes
      - expr: sum(project_namespace_fs_write_bytes) by (project_name)
        record: project_cluster_fs_write_bytes
      - expr: up{instance=~"(.*)60001"} * on(node) group_left(node_role) kube_node_labels
        record: k8s_component_apiserver_ready
      - expr: up{instance=~"(.*)2379"} * on(node) group_left(node_role) kube_node_labels
        record: k8s_component_etcd_ready
      - expr: up{instance=~"(.*)10251"} * on(node) group_left(node_role) kube_node_labels
        record: k8s_component_scheduler_ready
      - expr: up{instance=~"(.*)10252"} * on(node) group_left(node_role) kube_node_labels
        record: k8s_component_controller_manager_ready
      - expr: sum(apiserver_request_latencies_summary_sum) by (node) / sum(apiserver_request_latencies_summary_count)
          by (node)
        record: k8s_component_apiserver_request_latency
      - expr: sum(scheduler_e2e_scheduling_latency_microseconds_sum) by (node) / sum(scheduler_e2e_scheduling_latency_microseconds_count)
          by (node)
        record: k8s_component_scheduler_scheduling_latency
kind: ConfigMap
metadata:
  creationTimestamp: "2020-05-28T03:42:51Z"
  labels:
    managed-by: prometheus-operator
    prometheus-name: k8s
  name: prometheus-k8s-rulefiles-0
  namespace: kube-system
  ownerReferences:
  - apiVersion: monitoring.coreos.com/v1
    blockOwnerDeletion: true
    controller: true
    kind: Prometheus
    name: k8s
    uid: 21c02639-a095-11ea-afac-52540002fcf3
  resourceVersion: "971"
  selfLink: /api/v1/namespaces/kube-system/configmaps/prometheus-k8s-rulefiles-0
  uid: 4e7bd3c1-a095-11ea-afac-52540002fcf3
```

#### CPU使用量

HPA指标：CPU使用量 0.9核
```
apiVersion: autoscaling/v2beta1
kind: HorizontalPodAutoscaler
metadata:
  labels:
    app: test1
  name: test1
  namespace: default
spec:
  maxReplicas: 5
  metrics:
  - pods:
      metricName: k8s_pod_cpu_core_used
      targetAverageValue: 900m
    type: Pods
  minReplicas: 1
  scaleTargetRef:
    apiVersion: apps/v1beta2
    kind: Deployment
    name: azzdeploy01
```

#### CPU利用率(占节点) 

HPA指标：CPU利用率（占节点） 40%
```
apiVersion: autoscaling/v2beta1
kind: HorizontalPodAutoscaler
metadata:
  labels:
    app: test1
  name: test1
  namespace: default
spec:
  maxReplicas: 5
  metrics:
  - pods:
      metricName: k8s_pod_rate_cpu_core_used_node
      targetAverageValue: "40"
    type: Pods
  minReplicas: 1
  scaleTargetRef:
    apiVersion: apps/v1beta2
    kind: Deployment
    name: azzdeploy01
```

#### CPU利用率（占Request） 

HPA指标：CPU利用率（占Request） 50%

```
apiVersion: autoscaling/v2beta1
kind: HorizontalPodAutoscaler
metadata:
  labels:
    app: test1
  name: test1
  namespace: default
spec:
  maxReplicas: 5
  metrics:
  - pods:
      metricName: k8s_pod_rate_cpu_core_used_request
      targetAverageValue: "50"
    type: Pods
  minReplicas: 1
  scaleTargetRef:
    apiVersion: apps/v1beta2
    kind: Deployment
    name: azzdeploy01
```

#### CPU利用率（占Limit)

HPA指标：CPU利用率（占Limit） 80%
```
apiVersion: autoscaling/v2beta1
kind: HorizontalPodAutoscaler
metadata:
  labels:
    app: test1
  name: test1
  namespace: default
spec:
  maxReplicas: 5
  metrics:
  - pods:
      metricName: k8s_pod_rate_cpu_core_used_limit
      targetAverageValue: "80"
    type: Pods
  minReplicas: 1
  scaleTargetRef:
    apiVersion: apps/v1beta2
    kind: Deployment
    name: azzdeploy01
```

#### 内存使用量

HPA指标：内存使用量 500MiB
```
apiVersion: autoscaling/v2beta1
kind: HorizontalPodAutoscaler
metadata:
  labels:
    app: test1
  name: test1
  namespace: default
spec:
  maxReplicas: 5
  metrics:
  - pods:
      metricName: k8s_pod_mem_usage_bytes
      targetAverageValue: 500Mi
    type: Pods
  minReplicas: 1
  scaleTargetRef:
    apiVersion: apps/v1beta2
    kind: Deployment
    name: azzdeploy01
```

#### 内存使用量（不包含 Cache）

HPA指标：内存使用量（不包含 Cache） 500MiB
```
apiVersion: autoscaling/v2beta1
kind: HorizontalPodAutoscaler
metadata:
  labels:
    qcloud-app: test1
  name: test1
  namespace: default
spec:
  maxReplicas: 5
  metrics:
  - pods:
      metricName: k8s_pod_mem_no_cache_bytes
      targetAverageValue: 500Mi
    type: Pods
  minReplicas: 1
  scaleTargetRef:
    apiVersion: apps/v1beta2
    kind: Deployment
    name: azzdeploy01
```

#### 内存利用率（占节点）

HPA指标：内存利用率（占节点） 30%
```
apiVersion: autoscaling/v2beta1
kind: HorizontalPodAutoscaler
metadata:
  labels:
    app: test1
  name: test1
  namespace: default
spec:
  maxReplicas: 5
  metrics:
  - pods:
      metricName: k8s_pod_rate_mem_usage_node
      targetAverageValue: "30"
    type: Pods
  minReplicas: 1
  scaleTargetRef:
    apiVersion: apps/v1beta2
    kind: Deployment
    name: azzdeploy01
```

#### 内存利用率（占节点，不包含 Cache）

HPA指标：内存利用率（占节点，不包含 Cache）30%
```
  - pods:
      metricName: k8s_pod_rate_mem_no_cache_node
      targetAverageValue: "30"
    type: Pods
```

#### 内存利用率（占Request）

HPA指标：内存利用率（占Request）30%
```
  - pods:
      metricName: k8s_pod_rate_mem_usage_request
      targetAverageValue: "30"
    type: Pods
```


#### 内存利用率（占 Request，不包含Cache）

HPA指标：内存利用率（占 Request，不包含Cache）30
```
  - pods:
      metricName: k8s_pod_rate_mem_no_cache_request
      targetAverageValue: "30"
    type: Pods
```

#### 内存利用率（占 Limit)

HPA指标：内存利用率（占 Limit) 30%
```
  - pods:
      metricName: k8s_pod_rate_mem_usage_limit
      targetAverageValue: "30"
    type: Pods
```

#### 内存利用率（占 Limit，不包含 Cache）

HPA指标：内存利用率（占 Limit，不包含 Cache）30%
```
  - pods:
      metricName: k8s_pod_rate_mem_no_cache_limit
      targetAverageValue: "30"
    type: Pods
```

#### 硬盘写流量

HPA指标：硬盘写流量 1000KB/s
```
  - pods:
      metricName: k8s_pod_fs_write_bytes
      targetAverageValue: 1000Ki
    type: Pods
```

#### 硬盘读流量

HPA指标：硬盘读流量 1000KB/s
```
  - pods:
      metricName: k8s_pod_fs_read_bytes
      targetAverageValue: 1000Ki
    type: Pods
```

#### 硬盘读 IOPS

HPA指标：硬盘读 IOPS 1000次/s
```
  - pods:
      metricName: k8s_pod_fs_read_times
      targetAverageValue: 1k
    type: Pods
```

#### 硬盘写 IOPS

HPA指标：硬盘写 IOPS 1000次/s
```
  - pods:
      metricName: k8s_pod_fs_write_times
      targetAverageValue: 1k
    type: Pods
```

#### 网络入带宽

HPA指标：网络入带宽 100Mbps
```
  - pods:
      metricName: k8s_pod_network_receive_bytes_bw
      targetAverageValue: 100Mi
    type: Pods
```

#### 网络出带宽

HPA指标：网络出带宽 100Mbps
```
 - pods:
      metricName: k8s_pod_network_transmit_bytes_bw
      targetAverageValue: 100Mi
    type: Pods
```

#### 网络入流量

HPA指标：网络入流量 100KB/s
```
  - pods:
      metricName: k8s_pod_network_receive_bytes
      targetAverageValue: 100Ki
    type: Pods
```

#### 网络出流量

HPA指标：网络出流量 100KB/s
```
  - pods:
      metricName: k8s_pod_network_transmit_bytes
      targetAverageValue: 100Ki
    type: Pods
```

#### 网络入包量

HPA指标：网络入包量 100个
```
  - pods:
      metricName: k8s_pod_network_receive_packets
      targetAverageValue: "100"
    type: Pods
```

#### 网络出包量

HPA指标：网络出包量 100个
```
  - pods:
      metricName: k8s_pod_network_transmit_packets
      targetAverageValue: "100"
    type: Pods
```

### 自定义指标的autoscaling 

#### prometheus-adapter

创建一个nginx应用，暴露的prometheus metric路径为/status/format/prometheus
```
# vim /hpa-prom-demo.yaml 
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hpa-prom-demo
spec:
  selector:
    matchLabels:
      app: nginx-server
  template:
    metadata:
      labels:
        app: nginx-server
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "80"
        prometheus.io/path: "/status/format/prometheus"
    spec:
      containers:
      - name: nginx-demo
        image: vaibhavthakur/nginx-vts:v1.0
        resources:
          limits:
            cpu: 50m
          requests:
            cpu: 50m
        ports:
        - containerPort: 80
          name: http
---
apiVersion: v1
kind: Service
metadata:
  name: hpa-prom-demo
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "80"
    prometheus.io/path: "/status/format/prometheus"
spec:
  ports:
  - port: 80
    targetPort: 80
    name: http
  selector:
    app: nginx-server
  type: NodePort
```

```
# kubectl apply -f hpa-prom-demo.yaml 
```

```
# kubectl get svc hpa-prom-demo 
NAME            TYPE       CLUSTER-IP       EXTERNAL-IP   PORT(S)        AGE
hpa-prom-demo   NodePort   172.20.255.206   <none>        80:50933/TCP   6h14m
```

获取prometheus指标
```
curl http://172.20.255.206/status/format/prometheus
# HELP nginx_vts_info Nginx info
# TYPE nginx_vts_info gauge
nginx_vts_info{hostname="nginx-deployment-76d685cfc7-qvnxh",version="1.13.12"} 1
# HELP nginx_vts_start_time_seconds Nginx start time
# TYPE nginx_vts_start_time_seconds gauge
nginx_vts_start_time_seconds 1590993544.152
# HELP nginx_vts_main_connections Nginx connections
# TYPE nginx_vts_main_connections gauge
nginx_vts_main_connections{status="accepted"} 3
nginx_vts_main_connections{status="active"} 2
```

部署k8s-prometheus-adapter
```
# vim /root/hpa-prome-adapter-values.yaml 
rules:
  default: false
  custom:
  - seriesQuery: 'nginx_vts_server_requests_total'
    resources: 
      overrides:
        kubernetes_namespace:
          resource: namespace
        kubernetes_pod_name:
          resource: pod
    name:
      matches: "^(.*)_total"
      as: "${1}_per_second"
    metricsQuery: (sum(rate(<<.Series>>{<<.LabelMatchers>>}[5m])) by (<<.GroupBy>>))
 
prometheus:
  url: http://10.125.233.66
  port: 29175
```

```
# helm install --name prometheus-adapter stable/prometheus-adapter -f /root/hpa-prome-adapter-values.yaml
```

```
# helm ls
NAME                    REVISION        UPDATED                         STATUS          CHART                           APP VERSION     NAMESPACE
prometheus-adapter      1               Mon Jun  1 16:18:32 2020        DEPLOYED        prometheus-adapter-2.3.1        v0.6.0          default  
```

查看自定义指标的资源
```
# kubectl get --raw="/apis/custom.metrics.k8s.io/v1beta1" | jq .
{
  "kind": "APIResourceList",
  "apiVersion": "v1",
  "groupVersion": "custom.metrics.k8s.io/v1beta1",
  "resources": [
    {
      "name": "pods/nginx_vts_server_requests_per_second",
      "singularName": "",
      "namespaced": true,
      "kind": "MetricValueList",
      "verbs": [
        "get"
      ]
    },
    {
      "name": "namespaces/nginx_vts_server_requests_per_second",
      "singularName": "",
      "namespaced": false,
      "kind": "MetricValueList",
      "verbs": [
        "get"
      ]
    }
  ]
}
```

通过自定义metrics api获取pod指标
```
# kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1/namespaces/default/pods/*/nginx_vts_server_requests_per_second" | jq .
{
  "kind": "MetricValueList",
  "apiVersion": "custom.metrics.k8s.io/v1beta1",
  "metadata": {
    "selfLink": "/apis/custom.metrics.k8s.io/v1beta1/namespaces/default/pods/%2A/nginx_vts_server_requests_per_second"
  },
  "items": [
    {
      "describedObject": {
        "kind": "Pod",
        "namespace": "default",
        "name": "hpa-prom-demo-dfd69c997-gb6nx",
        "apiVersion": "/v1"
      },
      "metricName": "nginx_vts_server_requests_per_second",
      "timestamp": "2020-06-01T11:38:45Z",
      "value": "200m",
      "selector": null
    }
  ]
}
```

压测
```
# while true; do wget -q -O- http://172.20.255.206; done
```

打开另一个窗口，观测hpa变化
```
# kubectl describe horizontalpodautoscalers.autoscaling nginx-custom-hpa 
Name:                                              nginx-custom-hpa
Namespace:                                         default
Labels:                                            <none>
Annotations:                                       kubectl.kubernetes.io/last-applied-configuration:
                                                     {"apiVersion":"autoscaling/v2beta1","kind":"HorizontalPodAutoscaler","metadata":{"annotations":{},"name":"nginx-custom-hpa","namespace":"d...
CreationTimestamp:                                 Mon, 01 Jun 2020 20:11:13 +0800
Reference:                                         Deployment/hpa-prom-demo
Metrics:                                           ( current / target )
  "nginx_vts_server_requests_per_second" on pods:  29796m / 10
Min replicas:                                      2
Max replicas:                                      5
Deployment pods:                                   5 current / 5 desired
Conditions:
  Type            Status  Reason               Message
  ----            ------  ------               -------
  AbleToScale     True    ScaleDownStabilized  recent recommendations were higher than current one, applying the highest recent recommendation
  ScalingActive   True    ValidMetricFound     the HPA was able to successfully calculate a replica count from pods metric nginx_vts_server_requests_per_second
  ScalingLimited  True    TooManyReplicas      the desired replica count is more than the maximum replica count
Events:
  Type    Reason             Age   From                       Message
  ----    ------             ----  ----                       -------
  Normal  SuccessfulRescale  11m   horizontal-pod-autoscaler  New size: 2; reason: Current number of replicas below Spec.MinReplicas
  Normal  SuccessfulRescale  63s   horizontal-pod-autoscaler  New size: 4; reason: pods metric nginx_vts_server_requests_per_second above target
  Normal  SuccessfulRescale  48s   horizontal-pod-autoscaler  New size: 5; reason: pods metric nginx_vts_server_requests_per_second above target
```

#### kube-metrics-adapter

克隆kube-metrics-adapter项目
```
# git clone https://github.com/zalando-incubator/kube-metrics-adapter.git
```

```
# cd docs/
```

修改deployment启动参数，指定prometheus地址
```
# vim deployment.yaml 
        args:
        - --v=9
        - --prometheus-server=http://<prometheus-server地址>:9090
        - --skipper-ingress-metrics
        - --aws-external-metrics
```

apply yaml部署
```
# kubectl apply -f ./
```

查看kube-metrics-adapter deployment
```
# kubectl -n kube-system get deployments. kube-metrics-adapter 
NAME                   READY   UP-TO-DATE   AVAILABLE   AGE
kube-metrics-adapter   1/1     1            1           177m
```

kube-metrics-adapter的prometheus collector采用的是External metric api
```
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
  namespace: default
  annotations:
    metric-config.external.prometheus-query.prometheus/k8s_pod_cpu_core_used-hpa-prom-demo: |
      avg(k8s_pod_cpu_core_used{cluster_id="cls-7ffb5c05", namespace="default",workload_kind="Deployment",workload_name="hpa-prom-demo"})
    metric-config.external.prometheus-query.prometheus/k8s_pod_mem_usage_bytes-hpa-prom-demo: |
      avg(k8s_pod_mem_usage_bytes{cluster_id="cls-7ffb5c05", namespace="default",workload_kind="Deployment",workload_name="hpa-prom-demo"})
    metric-config.external.prometheus-query.prometheus/k8s_pod_fs_write_bytes-hpa-prom-demo: |
      avg(k8s_pod_fs_write_bytes{cluster_id="cls-7ffb5c05", namespace="default",workload_kind="Deployment",workload_name="hpa-prom-demo"})
    metric-config.external.prometheus-query.prometheus/k8s_pod_network_receive_bytes-hpa-prom-demo: |
      avg(k8s_pod_network_receive_bytes{cluster_id="cls-7ffb5c05", namespace="default",workload_kind="Deployment",workload_name="hpa-prom-demo"})
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: hpa-prom-demo
  minReplicas: 1
  maxReplicas: 10
  metrics:
  - type: External
    external:
      metric:
        name: prometheus-query
        selector:
          matchLabels:
            query-name: k8s_pod_cpu_core_used-hpa-prom-demo
      target:
        type: AverageValue
        averageValue: 900m
  - type: External
    external:
      metric:
        name: prometheus-query
        selector:
          matchLabels:
            query-name: k8s_pod_mem_usage_bytes-hpa-prom-demo
      target:
        type: AverageValue
        averageValue: 500Mi
  - type: External
    external:
      metric:
        name: prometheus-query
        selector:
          matchLabels:
            query-name: k8s_pod_fs_write_bytes-hpa-prom-demo
      target:
        type: AverageValue
        averageValue: 1000Ki
  - type: External
    external:
      metric:
        name: prometheus-query
        selector:
          matchLabels:
            query-name: k8s_pod_network_receive_bytes-hpa-prom-demo
      target:
        type: AverageValue
        averageValue: 100Ki
```
annotation那边定义的metrtic configKey不能重复

查看external metric api资源列表
```
# kubectl get --raw="/apis/external.metrics.k8s.io/v1beta1" | jq .
{
  "kind": "APIResourceList",
  "apiVersion": "v1",
  "groupVersion": "external.metrics.k8s.io/v1beta1",
  "resources": [
    {
      "name": "prometheus-query",
      "singularName": "",
      "namespaced": true,
      "kind": "ExternalMetricValueList",
      "verbs": [
        "get"
      ]
    }
  ]
}
```

查看external metric的指标值列表 
```
# kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/*/prometheus-query" | jq .
{
  "kind": "ExternalMetricValueList",
  "apiVersion": "external.metrics.k8s.io/v1beta1",
  "metadata": {
    "selfLink": "/apis/external.metrics.k8s.io/v1beta1/namespaces/default/prometheus-query"
  },
  "items": [
    {
      "metricName": "prometheus-query",
      "metricLabels": {
        "query-name": "k8s_pod_cpu_core_used"
      },
      "timestamp": "2020-06-02T12:03:06Z",
      "value": "0"
    }
  ]
}
```

#### kube-metrics-adapter vs prometheus-adapter

kube-metrics-adapter的Prometheus collector是通用收集器，可以将Prometheus查询映射到可用于扩展的指标。
这种方法与k8s-prometheus-adapter中的方法不同，在k8s-prometheus-adapter中，
所有可用的Prometheus指标都被收集并转换为HPA可以扩展的指标，并且不可能进行自定义查询。
使用kube-metrics-adapter的Prometheus collector实现的方法，用户可以定义自定义查询，并且只有从这些查询返回的指标才可用，从而减少了所存储指标的总数。

但是使用kube-metrics-adapter的Prometheus collector实现的方法也有缺点，查询效果不佳会减慢/杀死Prometheus，因此允许在多租户群集中进行查询操作可能很危险。
也不可能使用RBAC之类的方法来限制可用指标，因为任何用户都可以基于自定义查询创建指标。

面向开发者的话，自定义查询可能会更有用，但是最好知道这两种方法之间的差异以及面向的用户，然后再做取舍。

### 参考链接

- [Kubernetes：HPA 详解-基于 CPU、内存和自定义指标自动扩缩容](https://blog.csdn.net/fly910905/article/details/105375822)
- [Prometheus Metrics based autoscaling in Kubernetes](https://appfleet.com/blog/prometheus-metrics-based-autoscaling-in-kubernetes/)`
- [https://github.com/zalando-incubator/kube-metrics-adapter](https://github.com/zalando-incubator/kube-metrics-adapter)