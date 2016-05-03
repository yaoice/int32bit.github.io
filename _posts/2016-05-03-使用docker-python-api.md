---
layout: post
title: 使用docker python api
catalog: true
tags:
     - python
     - docker
     - magnum
---

docker支持python client api，项目地址:[docker-py](https://github.com/docker/docker-py)，安装最新版的api：

```bash
sudo pip install docker-py
```

**docker-py的api和docker命令行工具非常类似，熟悉docker命令行工具，基本就已经掌握了docker python api。**

在使用docker python api之前首先需要实例化Client建立docker daemon的连接：

```python
from docker import Client
cli = Client(base_url='unix://var/run/docker.sock')
```

### 列出容器列表

列出容器列表的api为`containers()`方法,其功能以及参数和docker命令行的`ps`基本一致：

* quiet (bool): 只输出id.
* all (bool): 默认只列出`running`状态的容器实例，`all`设为`True`,将列出所有的容器实例.
* trunc (bool): 截断输出.
* latest (bool): 这输出最近一次创建的实例.
* since (str): 列出在某个容器创建之后的实例.
* before (str): 列出在某个容器创建之前的实例.
* limit (int): 限制输出列表的长度. 
* size (bool): 显示容器的大小.
* filters (dict): 参考`docker ps --filter`. 支持的filters:
	+ exited (int): 列出指定退出码的容器实例.
	+ status (str): 列出指定状态的容器实例，支持的状态包括`restarting`, `running`, `paused`, `exited`.
	+ label (str): 列出指定标签的容器，格式为`"key"`或者`"key=value"`.
	+ id (str): 列出指定id的实例.
	+ name (str): 列出指定名称的实例.
	+ ancestor (str): 指定容器启动时的镜像，格式为`<image-name>[:tag]`, `<image-id>`, 或者`<image@digest>`.
	+ before (str): 参考`before`.
	+ since (str): 参考`since`.

返回是一个字典列表：

```python
from docker import Client
docker = Client(base_url="unix://var/run/docker.sock")
docker.containers(all = True)
```
输出：

```json
[{u'Command': u'/docker-entrypoint.sh rabbitmq-server',
  u'Created': 1461992075,
  u'HostConfig': {u'NetworkMode': u'default'},
  u'Id': u'84507a7b5b44116e2596b698a7b4404f3d892ab6cbd3107f7b3859e1c5f89e46',
  u'Image': u'rabbitmq:3',
  u'ImageID': u'sha256:f5635e9026111b71a32617071d693d892db955c5a857d94c621146bd20d9d897',
  u'Labels': {},
  u'Mounts': [{u'Destination': u'/var/lib/rabbitmq',
    u'Driver': u'local',
    u'Mode': u'',
    u'Name': u'9ad4e4830643130f2069694091233a3ff82194f733ff9547b53e847f59485530',
    u'Propagation': u'',
    u'RW': True,
    u'Source': u'/var/lib/docker/volumes/9ad4e4830643130f2069694091233a3ff82194f733ff9547b53e847f59485530/_data'}],
  u'Names': [u'/rabbitmq-0'],
  u'NetworkSettings': {u'Networks': {u'bridge': {u'Aliases': None,
     u'EndpointID': u'dc71f2ead929d3761c9e259bfbf6858e1d1095862965fd38c48fc094b8b3c710',
     u'Gateway': u'172.17.0.1',
     u'GlobalIPv6Address': u'',
     u'GlobalIPv6PrefixLen': 0,
     ...
```

由此可知，docker python api基本和docker命令行参数一致，接下来将列出一些常用的api，但不再解释各个api的参数，若需要详细参数，可以参考[官方文档](http://docker-py.readthedocs.io/en/latest/api/)。

### 创建容器

```python
container = docker.create_container(image='alpine', command='echo "HelloWorld!')
print(container['Id'])
# u'fbf14b7eb435d442be5ee51aca24626f2195116f0723607f7af3665ecf991c45'
```

**注意：**

* 和`docker run`不同，`image`必须存在，python docker api不会自动拉取不存在的镜像
* 和`docker run`不同，该api只创建容器，但并不会启动容器，必须手动执行`start`，这个与`docker create`命令类似。

### 启动容器

```python
response = docker.start(container=container.get('Id'))
```

### 列出镜像

```python
images = docker.images()
print(images)
```

### 拉取镜像

```python
>>> from docker import Client
>>> docker = Client(base_url='tcp://127.0.0.1:2375')
>>> for line in cli.pull('busybox', stream=True):
...     print(json.dumps(json.loads(line), indent=4))
{
    "status": "Pulling image (latest) from busybox",
    "progressDetail": {},
    "id": "e72ac664f4f0"
}
{
    "status": "Pulling image (latest) from busybox, endpoint: ...",
    "progressDetail": {},
    "id": "e72ac664f4f0"
}
```

### magnum项目应用

Mangum是OpenStack一个和Docker集成的新项目，用来向用户提供容器服务。在`common`目录下`docker_utils.py`使用了docker python api，定义了DockerHTTPClient，继承了docker python api的`docker.client.Client`类：

```python
class DockerHTTPClient(client.Client):
    def __init__(self, url='unix://var/run/docker.sock',
                 ver=CONF.docker.docker_remote_api_version,
                 timeout=CONF.docker.default_timeout,
                 ca_cert=None,
                 client_key=None,
                 client_cert=None):

        if ca_cert and client_key and client_cert:
            ssl_config = tls.TLSConfig(
                client_cert=(client_cert, client_key),
                verify=ca_cert,
                assert_hostname=False,
            )
        else:
            ssl_config = False

        super(DockerHTTPClient, self).__init__(
            base_url=url,
            version=ver,
            timeout=timeout,
            tls=ssl_config
        )
```

在`conductor/handlers/docker_conductor.py`创建容器源码：

```python
@wrap_container_exception
    def container_create(self, context, container):
        with docker_utils.docker_for_container(context, container) as docker:
            name = container.name
            container_uuid = container.uuid
            image = container.image
            LOG.debug('Creating container with image %s name %s', image, name)
            try:
                image_repo, image_tag = docker_utils.parse_docker_image(image)
                docker.pull(image_repo, tag=image_tag)
                docker.inspect_image(self._encode_utf8(container.image))
                kwargs = {'name': name,
                          'hostname': container_uuid,
                          'command': container.command,
                          'environment': container.environment}
                if docker_utils.is_docker_api_version_atleast(docker, '1.19'):
                    if container.memory is not None:
                        kwargs['host_config'] = {
                            'Memory':
                            magnum_utils.get_docker_quanity(container.memory)}
                else:
                    kwargs['mem_limit'] = container.memory

                docker.create_container(image, **kwargs)
                container.status = fields.ContainerStatus.STOPPED
                return container
            except errors.APIError:
                container.status = fields.ContainerStatus.ERROR
                raise
            finally:
                container.save()
```
该方法首先解析参数，然后执行pull操作拉取镜像（如果镜像已经存在，此为空操作），然后执行inspect_image操作，判断该镜像是否已经存在，如果不存在会抛出异常，由`@wrap_container_exception`捕获，最后执行`create_container`创建容器，保存到数据库中。

### 参考

参考[官方文档](http://docker-py.readthedocs.io/en/latest/api/)。






 