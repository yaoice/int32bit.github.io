---
layout: post
title: Openstack使用stevedore实现动态加载插件
subtitle: Openstack源码分析系列文章
catalog: true
tags:
     - openstack
     - 源码分析
---


使用python很容易实现动态加载代码， 比如使用`__import__`或者`importlib`。我们通过配置可以运行时发现(discover)和加载(load)插件从而实现应用的扩展。`stevedore`采用一种基于[setuptools entry points](http://packages.python.org/setuptools/pkg_resources.html#convenience-api)插件的管理机制。

`entry_points`是一个字典，从entry point组名映射到表示entry point的字符串或字符串列表,这个字符串表示对应的插件。Entry points可用来支持动态自动发现服务和插件以及自动生成脚本。stevedore提供的插件管理功能实现了动态加载扩展模块的几种通用模式，各种[模式介绍](http://docs.openstack.org/developer/stevedore/patterns_loading.html)。

在Openstack中使用stevedore最经典的就是数据库驱动，在大多数组件中，比如magnum,nova等，都有一个`db`目录，该目录封装了对数据库的操作，在db目录下有一个`migration.py`文件，该文件定义了如何加载数据库后端驱动：

```python
from oslo_config import cfg
from stevedore import driver

_IMPL = None

def get_backend():
    global _IMPL
    if not _IMPL:
        cfg.CONF.import_opt('backend', 'oslo_db.options', group='database')
        _IMPL = driver.DriverManager("magnum.database.migration_backend",
                                     cfg.CONF.database.backend).driver
    return _IMPL
```

`cfg.CONF.database.backend`通常为`sqlalchemy`

为什么使用这种方式？通过大量的试验和教训，开发者发现最有效简单定义API方法包括以下几个步骤：

* 使用`abc`模块创建一个抽象基类，该基类定义了必需的API。虽然开发者并非必须继承该基类，但它提供了方便的方式生成API文档。
* 创建新的插件，新的插件继承基类并实现了以上基类的抽象方法。
* 为每一个API定义一个唯一的命名空间和API名称。

下面模拟openstack db的方式实现动态加载插件，代码目录结构如下：

```bash
fgp@ubuntu:~/python$ find .
.
./stevedore
./stevedore/setup.py
./stevedore/stevedemo
./stevedore/stevedemo/__init__.py
./stevedore/stevedemo/base.py
./stevedore/stevedemo/mysql
./stevedore/stevedemo/mysql/mysql_driver.py
./stevedore/stevedemo/mysql/__init__.py
./stevedore/stevedemo/mysql/mysql_driver.pyc
./stevedore/stevedemo/mysql/__init__.pyc
./stevedore/stevedemo/oracle
./stevedore/stevedemo/oracle/__init__.py
./stevedore/stevedemo/oracle/oracle_driver.py
./stevedore/stevedemo/__init__.pyc
./stevedore/stevedemo/base.pyc
```

首先我们实现基类：

```python
# stevedore/stevedemo/bash.py
import abc
import six

@six.add_metaclass(abc.ABCMeta)
class Driver:

   def __init__(self, version):
       self.__version__ = version

   def version(self):
       return self.__version__

   @abc.abstractmethod
   def connect(self):
       pass

   @abc.abstractmethod
   def query(self, sql =  None):
       pass
```
我们定义了两个抽象方法，分别为`connect`和`query`。

接下来我们实现两个插件，继承了该基类并实现了抽象方法：

```python
# stevedore/stevedemo/mysql/mysql_driver.py
from stevedemo import base

class MysqlDriver(base.Driver):

    def connect(self):
        print("Load mysql successfully!")

    def query(self, sql):
        print("Execute query from mysql-%s: '%s'" % (self.version(), sql))
        
        from stevedemo import base
        
# stevedore/stevedemo/oracle/oracle_driver.py
class OracleDriver(base.Driver):

    def connect(self):
        print("Load oracle successfully!")

    def query(self, sql):
        print("Execute query from oracle-%s: '%s'" % (self.version(), sql))
```

为了使用setuptools工具(python打包和分发工具）的entry points，首先必须打包应用。构建和打包过程中会生成一系列元数据，这些元数据定义了如何去寻找和加载这些插件。每一个插件的entry points必须定义一个唯一的命名空间，我们使用`stevedemo.Driver`作为我们使用的命名空间：

```python
# stevedore/setup.py

from setuptools import setup, find_packages

setup(
   name = "test-database-driver",
   version = "1.0",
   description = "test database driver desc",
   author = "author",
   author_email = "auhor@example.com",
   platforms = ['Any'],
   packages = find_packages(),
   scripts = [ ],
   include_package_data = True,
   entry_points = {
       'stevedemo.Driver': [
           'mysql = stevedemo.mysql.mysql_driver:MysqlDriver',
           'oracle = stevedemo.oracle.oracle_driver:OracleDriver',
       ],
   },
   zip_safe = False,
)
```
最关键的是最末尾的`setup()`方法的参数`entry_points`，它是一个字典，映射命名空间到定义的插件列表。每一个元素必须是`name = module:importable`格式，其中`name`是插件的名称，用户将通过该名称来定位使用的插件。`module`是该插件对应的模块,`importable`是能够被python import的类文件(同一目录下有`__init__.py`文件）。在我们这个例子中，共注册了两个插件，分别为`mysql`和`oracle`。

我们执行`setup.py build`构建代码：

```bash
fgp@ubuntu:~/python/stevedore$ ./setup.py build
running build
running build_py
creating build
creating build/lib.linux-x86_64-2.7
creating build/lib.linux-x86_64-2.7/stevedemo
copying stevedemo/__init__.py -> build/lib.linux-x86_64-2.7/stevedemo
copying stevedemo/base.py -> build/lib.linux-x86_64-2.7/stevedemo
creating build/lib.linux-x86_64-2.7/stevedemo/mysql
copying stevedemo/mysql/mysql_driver.py -> build/lib.linux-x86_64-2.7/stevedemo/mysql
copying stevedemo/mysql/__init__.py -> build/lib.linux-x86_64-2.7/stevedemo/mysql
creating build/lib.linux-x86_64-2.7/stevedemo/oracle
copying stevedemo/oracle/__init__.py -> build/lib.linux-x86_64-2.7/stevedemo/oracle
copying stevedemo/oracle/oracle_driver.py -> build/lib.linux-x86_64-2.7/stevedemo/oracle
running egg_info
creating test_database_driver.egg-info
writing test_database_driver.egg-info/PKG-INFO
writing top-level names to test_database_driver.egg-info/top_level.txt
writing dependency_links to test_database_driver.egg-info/dependency_links.txt
writing entry points to test_database_driver.egg-info/entry_points.txt
writing manifest file 'test_database_driver.egg-info/SOURCES.txt'
reading manifest file 'test_database_driver.egg-info/SOURCES.txt'
writing manifest file 'test_database_driver.egg-info/SOURCES.txt'
```
在构建过程中，setuptools工具自动拷贝entry point元数据到`xxx.egg-info`目录，比如stevedore文件的entry列表位于`test_database_driver.egg-info/entry_points.txt`,内容为：

```
[stevedemo.Driver]
mysql = stevedemo.mysql.mysql_driver:MysqlDriver
oracle = stevedemo.oracle.oracle_driver:OracleDriver
```

`pkg_resources`根据这个文件从所有安装的包中寻找插件，用户不能直接修改这个文件来修改entry point，而必须通过修改`setup.py`来改变entry point.

构建没有问题后，我们打包安装到python的dist-packages中：

```bash
sudo python setup.py install
```

安装后，我们可以通过多种方式来加载我们的模块，其中最常用是采用可插除的插件方式。这种方式通常会从多种插件中选择其中一个插件，只有被选择的这个插件才会被加载和调用。`DriverManager`就是支持这种模式的类，这也是openstack db模块使用的方式。

一旦安装，我们可以在系统的任何地方调用我们的模块:

```python
# ~/test.py

from stevedore import driver

mgr = driver.DriverManager(
    namespace = "stevedemo.Driver",
    name = "mysql",
    invoke_on_load = True,
    invoke_args = ("5.5",),
)

mgr.driver.connect()
mgr.driver.query("select * from user;")
```

调用`driver.DriverManager`方法，我们需要指定命名空间以及名称，`invoke_on_load`的作用是定义加载时是否自动实例化，如果为false，返回的是一个类（必须调用构造方法实例化，比如`mgr.driver("5.5").connect()`），否则返回一个实例，不需要再实例化，直接可以调用实例方法，其中`invoke_args`传递的是构造方法参数。

我们执行该脚本：

```
fgp@ubuntu:~$ python test.py
Load mysql successfully!
Execute query from mysql-5.5: select * from user;
```

当我们需要使用oracle时，只需要修改`name`参数为`oracle`即可。当我们需要使用其他数据库后端时，比如sqlite,只需要继承base类并实现抽象方法，可以位于不同的包和路径，只需要保证具有相同的命名空间并且注册到entry point中即可。

另外一种比较常用的使用方式是同时加载多个插件，并执行所有插件的方法，在openstack最经典的案例就是filter，比如cinder（或者nova）在scheduler中需要加载所有的filter，在base_handler中：

```python
class BaseHandler(object):
    """Base class to handle loading filter and weight classes."""
    def __init__(self, modifier_class_type, modifier_namespace):
        self.namespace = modifier_namespace
        self.modifier_class_type = modifier_class_type
        self.extension_manager = extension.ExtensionManager(modifier_namespace)
```

接下来介绍如何使用`ExtensionManager`,其他的比如`NamedExtensionManager`和`EnabledExtensionManager`可以参照具体文档。

```python
# ~/test2.py

from __future__ import print_function
from stevedore import extension

mgr = extension.ExtensionManager(
    namespace = "stevedemo.Driver",
    invoke_on_load = True,
    invoke_args = ("5.5",),
)

print("mysql" in mgr)

def query(ext, sql):
    return (ext.name, ext.obj.query(sql))

results = mgr.map(query, "select * from users;")
```

输出：

```bash
fgp@ubuntu:~$ ./test2.py
True
Execute query from oracle-5.5: 'select * from users;'
Execute query from mysql-5.5: 'select * from users;'
```

我们发现`ExtensionManager`的创建和`DriverManager`只有一点区别，**不需要指定插件名称**，因为它会加载所有在这个命名空间的插件。插件加载的顺序也不需要定义，它依赖于包加载顺序和读取metadata文件的方式。如果需要保证加载顺序，可以使用`NamedExtensionManager`.

我们传递分离的参数到map方法中，而不是直接调用插件，为什么呢？如果map直接调用插件，每个插件必须是callable的，这就意味着命名空间区分纯粹就是插件的方法了，而使用分离的callable 参数，插件API不需要完全匹配use case，这可以使开发者自由创建更好的API，创建更多自己的方法，以不同的方式调用来完成不同的目的。

## 参考

* [Patterns for Loading](http://docs.openstack.org/developer/stevedore/patterns_loading.html)
* [Patterns for Enabling](http://docs.openstack.org/developer/stevedore/patterns_enabling.html)
