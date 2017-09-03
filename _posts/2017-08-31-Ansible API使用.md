---
layout: post
title: Ansible API使用
subtitle: ""
catalog: true
tags:
     - Ansible
---

## 背景

ansible作为自动化运维工具的后起之秀，现今使用甚广！今天这里探讨对ansible2.0 api的使用，不讨论ansible1.0的api, 用官方的话概括为2.0的api更强大，但稍微复杂点；记录ansible api的使用供日后打造以ansible为中心的自动化运维平台做铺垫,哈哈😄！

## 安装

安装相关依赖包

    [root@VM_0_13_centos ~]# yum install -y gcc python-devel

使用pip安装ansible

    [root@VM_0_13_centos ~]# pip install ansible

ansible如果使用ssh密码认证的话，需要这个包

    [root@VM_0_13_centos ~]# yum install -y sshpass

## 查看Ansible版本

    [root@ansible ~]# python
    Python 2.7.5 (default, Nov  6 2016, 00:28:07)
    [GCC 4.8.5 20150623 (Red Hat 4.8.5-11)] on linux2
    Type "help", "copyright", "credits" or "license" for more information.
    >>> import ansible
    >>> print ansible.__version__
    2.3.1.0

## 如何调用Ansible API

这里引用Ansible官方的例子来做讲解。

### 调用module API

导入相关的python库

    #!/usr/bin/env python

    import json
    from collections import namedtuple
    from ansible.parsing.dataloader import DataLoader
    from ansible.vars import VariableManager
    from ansible.inventory import Inventory
    from ansible.playbook.play import Play
    from ansible.executor.task_queue_manager import TaskQueueManager
    from ansible.plugins.callback import CallbackBase

定义用于结果返回的callback类，继承于CallbackBase类

    class ResultCallback(CallbackBase):
        """A sample callback plugin used for performing an action as results come in

        If you want to collect all results into a single object for processing at
        the end of the execution, look into utilizing the ``json`` callback plugin
        or writing your own custom callback plugin

        更多callback函数定义，见plugins/callback/__init__.py
        """
        def v2_runner_on_ok(self, result, **kwargs):
          """Print a json representation of the result

          This method could store the result in an instance attribute for retrieval later
          """
          host = result._host
          print json.dumps({host.name: result._result}, indent=4)

初始化节点

    # 设置需要初始化的ansible配置参数
    Options = namedtuple('Options', ['connection', 'module_path', 'forks', 'become', 'become_method', 'become_user', 'check'])
    # 初始化需要的对象
    variable_manager = VariableManager()
    loader = DataLoader()
    # connection这里用ssh连接方式，本地可以用local; module_path指定正确的ansible module路径
    options = Options(connection='smart', module_path='/usr/lib/python2.7/site-packages/ansible/modules/', forks=100, become=None, become_method=None, become_user=None, check=False)
    # passwords = dict(vault_pass='secret')
    passwords = None

    # Instantiate our ResultCallback for handling results as they come in
    results_callback = ResultCallback()
    # ssh连接采用password认证
    variable_manager.extra_vars={"ansible_user": "root", "ansible_ssh_pass": "xxxxxx@123"}
    # 初始化inventory， host_list后面可以是列表或inventory文件
    inventory = Inventory(loader=loader, variable_manager=variable_manager, host_list='/tmp/hosts')
    variable_manager.set_inventory(inventory)

定义要执行的任务module

    # create play with tasks
    play_source =  dict(
        name = "Ansible Play",
        hosts = 'all',   # 这里指定all
        gather_facts = 'no',
        tasks = [
            dict(action=dict(module='shell', args='ls'), register='shell_out'),
            dict(action=dict(module='debug', args=dict(msg='{{shell_out.stdout}}')))
            ]
      )
    play = Play().load(play_source, variable_manager=variable_manager, loader=loader)

运行任务

    # actually run it
    tqm = None
    try:
        tqm = TaskQueueManager(
                inventory=inventory,
                variable_manager=variable_manager,
                loader=loader,
                options=options,
                passwords=passwords,
                stdout_callback=results_callback,  # Use our custom   callback instead of the ``default`` callback plugin
          )
        result = tqm.run(play)
    finally:
        if tqm is not None:
            tqm.cleanup()


运行结果

    [root@VM_0_13_centos ~]# python test.py
    {
        "172.16.0.13": {
        "_ansible_parsed": true,
        "stderr_lines": [],
        "cmd": "ls",
        "end": "2017-09-03 09:30:06.282378",
        "_ansible_no_log": false,
        "stdout": "test.py",
        "changed": true,
        "rc": 0,
        "start": "2017-09-03 09:30:06.269082",
        "stderr": "",
        "delta": "0:00:00.013296",
        "invocation": {
            "module_args": {
                "warn": true,
                "executable": null,
                "_uses_shell": true,
                "_raw_params": "ls",
                "removes": null,
                "creates": null,
                "chdir": null
            }
        },
        "stdout_lines": [
            "test.py"
        ]
        }
        }
        {
        "172.16.0.13": {
        "msg": "test.py",
        "changed": false,
        "_ansible_verbose_always": true,
        "_ansible_no_log": false
        }
    }


### 调用Playbook API

导入调用playbook API需要的库

    #!/usr/bin/env python

    from collections import namedtuple
    from ansible.parsing.dataloader import DataLoader
    from ansible.vars import VariableManager
    from ansible.inventory import Inventory
    from ansible.executor.playbook_executor import PlaybookExecutor


初始化节点

    # initialize needed objects
    variable_manager = VariableManager()
    loader = DataLoader()
    # 换一种方式，指定ssh密码
    passwords = dict(conn_pass='xxxx@123')

    Options = namedtuple('Options',
                         ['connection',
                          'remote_user',
                          'ask_sudo_pass',
                          'verbosity',
                          'ack_pass',
                          'module_path',
                          'forks',
                          'become',
                          'become_method',
                          'become_user',
                          'check',
                          'listhosts',
                          'listtasks',
                          'listtags',
                          'syntax',
                          'sudo_user',
                          'sudo'])

    options = Options(connection='smart',
                      remote_user='root',
                      ack_pass=None,
                      sudo_user='root',
                      forks=5,
                      sudo='yes',
                      ask_sudo_pass=False,
                      verbosity=5,
                      module_path='/usr/lib/python2.7/site-packages/ansible/modules/',
                      become=True,
                      become_method='sudo',
                      become_user='root',
                      check=None,
                      listhosts=None,
                      listtasks=None,
                      listtags=None,
                      syntax=None)

    inventory = Inventory(loader=loader, variable_manager=variable_manager, host_list='inventory/multinode')
    variable_manager.set_inventory(inventory)

运行任务

    playbooks=['tt.yml']
    pb = PlaybookExecutor(playbooks=playbooks, inventory=inventory, variable_manager=variable_manager, loader=loader, options=options, passwords=passwords)
    result = pb.run()
    print result

运行结果

    [root@VM_0_13_centos openstack-deploy]# python test.py

    PLAY [Apply role chrony] ***********************************************************************************************************************************************************************************

    TASK [Gathering Facts] *************************************************************************************************************************************************************************************
    ok: [172.16.0.13]

    TASK [test : Install chrony packages] **********************************************************************************************************************************************************************
    ok: [172.16.0.13]

    PLAY RECAP *************************************************************************************************************************************************************************************************
    172.16.0.13                : ok=2    changed=0    unreachable=0    failed=0


## 参考链接

[http://docs.ansible.com/ansible/latest/dev_guide/developing_api.html#python-api-2-0](http://docs.ansible.com/ansible/latest/dev_guide/developing_api.html#python-api-2-0)
[http://www.voidcn.com/article/p-yroexafi-bdx.html](http://www.voidcn.com/article/p-yroexafi-bdx.html)
