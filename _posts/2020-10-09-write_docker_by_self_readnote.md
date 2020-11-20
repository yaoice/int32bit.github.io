---
layout: post
title: 《自己动手写docker》阅读笔记
subtitle: ""
catalog: true
tags:
     - k8s
---

### 环境

- go版本：1.14.6
- 系统：Ubuntu 20.04.1 LTS

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
```go
page main

import (
    "log"
    "os"
    "os/exec"
    "syscall"
)

func main() {
    cmd := exec.Command("sh")
    cmd.SysProcAttr = &syscall.SysProcAttr{
        Cloneflags: syscall.CLONE_NEWUTS,
    }
    cmd.Stdin = os.Stdin
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr

    if err := cmd.Run(); err != nil {
        log.Fatal(err)
    }
}
```

通过pstree找到父进程与子进程的pid，并查看进程的uts

```bash
# pstree -pl |grep goland
|-goland.sh(38417)---java(38466)-+-bash(39204)---sudo(47165)---bash(47166)---go(47637)-+-test(47743)-+-sh(47748)
```

```bash
# readlink /proc/47743/ns/uts 
uts:[4026531838]
# readlink /proc/47748/ns/uts 
uts:[4026532923]
<<<<<<< HEAD
```

父进程与子进程的uts不同，也就是说在子进程(新shell环境)中修改hostname，不会影响到宿主机

#### IPC Namespace

>IPC Namespace 用来隔离 System V IPC和POSIX message queues 。每一个IPC Namespace
>都有自己的System V IPC 和 POSIX message queue 。

Go创建IPC Namespace，多传了一个CLONE_NEWIPC参数ce，多传一个CLONE_NEWNS参数

```
package main

import (
    "log"
    "os"
    "os/exec"
    "syscall"
)

func main() {
    cmd := exec.Command("sh")
    cmd.SysProcAttr = &syscall.SysProcAttr{
        Cloneflags: syscall.CLONE_NEWUTS | syscall.CLONE_NEWIPC,
    }
    cmd.Stdin = os.Stdin
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr

    if err := cmd.Run(); err != nil {
        log.Fatal(err)
    }
}
```

验证ipc 隔离效果

```bash
#宿主机打开shell,查看宿主机上的ipc message queues
# ipcs -q

--------- 消息队列 -----------
键        msqid      拥有者  权限     已用字节数 消息      

#创建一个message queue
# ipcmk -Q
消息队列 id：0
# ipcs -q

--------- 消息队列 -----------
键        msqid      拥有者  权限     已用字节数 消息      
0x0e08da84 0          root       644        0            0           
```

```bash
#在宿主机上再开一个shell，运行程序
# go run test.go 
# ipcs -q

--------- 消息队列 -----------
键        msqid      拥有者  权限     已用字节数 消息      
```

在第二个shell中看不到 已创建的message queue，ipc隔离是有效的 。

#### PID Namespace

>PID Namespace是用来隔离进程 ID的 。同样一个进程在不同的PID Namespace里可以拥
>有不同的PID 。这样就可以理解 ,在docker container里面 , 使用ps -ef经常会发现,在容器
>内 , 前台运行的那个进程 PID 是 1 , 但是在容器外 ,使用ps -ef会发现同样的进程却有不同的
>PID , 这就是 PID Namespace做的事情。

Go创建PID Namespace，多传一个CLONE_NEWPID参数

```go
package main

import (
    "log"
    "os"
    "os/exec"
    "syscall"
)

func main() {
    cmd := exec.Command("sh")
    cmd.SysProcAttr = &syscall.SysProcAttr{
        Cloneflags: syscall.CLONE_NEWUTS | syscall.CLONE_NEWIPC | syscall.CLONE_NEWPID,
    }
    cmd.Stdin = os.Stdin
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr

    if err := cmd.Run(); err != nil {
        log.Fatal(err)
    }
}
```

验证PID隔离

```bash
# 运行程序
# go run test.go 
# echo $$
1
```

当前Namespace中的PID是1

```bash
# 另开一个shell,在宿主机上pstree -pl查看进程的真实PID
# pstree -pl | grep goland
|-goland.sh(38417)---java(38466)-+-bash(39204)---sudo(47165)---bash(47166)---go(49493)-+-test(49592)-+-sh(49597)
```

宿主机上main函数运行的PID是49592，映射到Namespace里的PID为1

#### Mount Namespace

>Mount Namespace 用来隔离各个进程看到 的挂载点视图。在不同Namespace的进程中,看
>到的文件系统层次是不一样的。在Mount Namespace 中调用mount()和umount() 仅仅只会影响
>当前Namespace内的文件系统 ,而对全局的文件系统是没有影响的。

Go创建Mount Namespace，多传一个CLONE_NEWNS参数

```go
package main

import (
    "log"
    "os"
    "os/exec"
    "syscall"
)

func main() {
    cmd := exec.Command("sh")
    cmd.SysProcAttr = &syscall.SysProcAttr{
        Cloneflags: syscall.CLONE_NEWUTS | syscall.CLONE_NEWIPC |
            syscall.CLONE_NEWPID | syscall.CLONE_NEWNS,
    }
    cmd.Stdin = os.Stdin
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr
    
    //mount proc
    syscall.Mount("", "/", "", syscall.MS_PRIVATE|syscall.MS_REC, "")
    defaultMountFlags := syscall.MS_NOEXEC | syscall.MS_NOSUID | syscall.MS_NODEV
    syscall.Mount("proc", "/proc", "proc", uintptr(defaultMountFlags), "")

    syscall.Mount("tmpfs", "/dev", "tmpfs", syscall.MS_NOSUID|syscall.MS_STRICTATIME, "mode=755")    

    if err := cmd.Run(); err != nil {
        log.Fatal(err)
    }
}
```

验证Mount Namespace隔离

```bash
# go run test.go
#这里的/proc还是宿主机的
# ls /proc      
1     1274   17528  21452  26143  312    415    46819  5260  61    824        execdomains
10    1277   17578  21463  26159  3127   416    46822  5262  614   825        fb
100   128    17585  215    262    313    417    46923  5266  63    828        filesystems
101   1280   17586  216    26205  3151   419    46954  5268  631   83         fs
102   1288   17590  217    26227  3170   42     4696   5271  632   834        i8k
103   1293   17591  218    26230  318    420    47     528   633   84         interrupts
104   13     17592  22     26236  33     423    47159  5289  635   842        iomem
1042  130    17593  220    263    34     424    47165  529   638   847        ioports
1044  1304   17596  221    264    3486   425    47166  5292  64    848        irq
106   131    176    222    265    3488   43     4781   53    641   849        kallsyms
107   1311   17623  223    26518  3492   434    4798   530   643   85         kcore
1078  1314   17627  224    266    3498   437    48     531   646   855        keys
108   1316   17741  226    26625  3499   438    4802   532   65    8696       key-users
109   132    17743  227    268    35     43805  4803   533   651   87         kmsg
11    133    178    228    269    3502   43807  4804   534   657   871        kpagecgroup
110   1334   17844  229    27     3554   43840  4806   5341  658   877        kpagecount
1113  134    17858  23     270    35585  43873  4810   535   659   885        kpageflags
112   1346   179    230    271    3565   43876  48544  536   66    886        loadavg
113   136    18     232    272    3568   439    49     537   661   89         locks
114   137    180    233    274    36     4442   4972   5376  662   90         mdstat
1143  138    181    234    275    360    4469   4977   538   669   908        meminfo
1144  139    18158  235    276    361    4470   49783  539   67    91         misc
1147  14     18163  236    27668  362    4496   49829  54    671   92         modules
115   140    182    237    277    365    45     4987   540   673   922        mounts
1151  1415   18239  238    27776  366    4519   4989   541   674   925        mtrr
......
```

```bash
#proc目录通常情况下是由系统自动挂载在/proc目录下，但是我们也可以自行手动挂载．proc也是一个文件系统,
#将/proc mount到namespace中来
# mount -t proc proc /proc
# ls /proc/       
1          crypto       interrupts   kpagecount  net           stat           version_signature
7          devices      iomem        kpageflags  pagetypeinfo  swaps          vmallocinfo
acpi       diskstats    ioports      loadavg     partitions    sys            vmstat
asound     dma          irq          locks       pressure      sysrq-trigger  zoneinfo
buddyinfo  driver       kallsyms     mdstat      sched_debug   sysvipc
bus        execdomains  kcore        meminfo     schedstat     thread-self
cgroups    fb           keys         misc        scsi          timer_list
cmdline    filesystems  key-users    modules     self          tty
consoles   fs           kmsg         mounts      slabinfo      uptime
cpuinfo    i8k          kpagecgroup  mtrr        softirqs      version
 
# ps ef   
PID TTY      STAT   TIME COMMAND
1 pts/1    S      0:00 sh SHELL=/bin/bash SUDO_GID=1000 LANGUAGE=zh_CN:zh GOPRIVATE=git.co
8 pts/1    R+     0:00 ps ef SUDO_GID=1000 LESSOPEN=| /usr/bin/lesspipe %s MAIL=/var/mail/

# top
top - 17:30:10 up  1:49,  1 user,  load average: 0.89, 0.58, 0.41
任务:   2 total,   1 running,   1 sleeping,   0 stopped,   0 zombie
%Cpu(s):  0.9 us,  0.4 sy,  0.0 ni, 98.6 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st
MiB Mem :  96314.6 total,  84921.8 free,   3963.3 used,   7429.5 buff/cache
MiB Swap:   2048.0 total,   2048.0 free,      0.0 used.  91284.3 avail Mem 

 进程号 USER      PR  NI    VIRT    RES    SHR    %CPU  %MEM     TIME+ COMMAND                 
      1 root      20   0    2608   1624   1532 S   0.0   0.0   0:00.00 sh                   
      9 root      20   0   20352   3784   3280 R   0.0   0.0   0:00.00 top                      
      
```

mount操作并没有影响到宿主机，所以Mount Namespace是隔离的；可以用ps和top来查看进程了，因为ps和top会去读/proc；Docker volume也是这个特性。

#### User Namespace

>User N amespace 主要是隔离用户 的 用户组 ID 。也就是说 , 一个进程的 User ID 和 Group
>ID 在 User Namespace 内外可以是不同 的 。 比较常用的是,在宿主机上以 一个非 root 用户运行
>创建一个 User Namespace , 然后在 User Namespace 里面却映射成 root 用户。这意味着 , 这个
>进程在 User Namespace 里面有 root 权限,但是在 User Namespace 外面却没有 root 的权限。从
>Linux Kernel 3 . 8 开始 , 非 root 进程 也可以创建 User Namespace , 并且此用户在 Namespace 里
>面可以被映射成 root , 且在 Namespace内有root 权限。

Go创建User Namespace

```go
package main

import (
    "log"
    "os"
    "os/exec"
    "syscall"
)

func main() {
    cmd := exec.Command("sh")
    cmd.SysProcAttr = &syscall.SysProcAttr{
        Cloneflags: syscall.CLONE_NEWUTS |
            syscall.CLONE_NEWIPC |
            syscall.CLONE_NEWPID |
            syscall.CLONE_NEWNS |
            syscall.CLONE_NEWUSER,
            //设置容器的UID
            UidMappings: []syscall.SysProcIDMap{{ContainerID: 0, HostID: 0, Size: 1}},
            //设置容器的GID        
            GidMappings: []syscall.SysProcIDMap{{ContainerID: 0, HostID: 0, Size: 1}},
    }   
    cmd.Stdin = os.Stdin
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr

    if err := cmd.Run(); err != nil {
        log.Fatal(err)
    }
}
```

验证User Namespace隔离

```bash
# 宿主机上查看执行用户
# id
uid=0(root) gid=0(root) 组=0(root)

# 执行程序
# go run test.go 
$ 
# 在namespace中查看执行用户
$ id
uid=65534(nobody) gid=65534(nogroup) 组=65534(nogroup)
$ exit
```

UID不同，说明User Namespace隔离有效。

#### Network Namespace

>Network Namespace 是用来隔离网络设备、IP 地址端口等网络械的Namespace 。Network
>Namespace可以让每个容器拥有自己独立的(虚拟的)网络设备, 而且容器内的应用可以绑定
>到自己的端口,每个 Namespace 内的端口都不会互相冲突。在宿主机上搭建网桥后,就能很方
>便地实现容器之间的通信,而且不同容器上的应用可以使用相同的端口。

Go创建Network Namespace

```go
package main

import (
    "log"
    "os"
    "os/exec"
    "syscall"
)

func main() {
    cmd := exec.Command("sh")
    cmd.SysProcAttr = &syscall.SysProcAttr{
        Cloneflags: syscall.CLONE_NEWUTS |
            syscall.CLONE_NEWIPC |
            syscall.CLONE_NEWPID |
            syscall.CLONE_NEWNS |
            syscall.CLONE_NEWUSER |
            syscall.CLONE_NEWNET,
    }
    cmd.Stdin = os.Stdin
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr

    if err := cmd.Run(); err != nil {
        log.Fatal(err)
    }
}
```

验证Network Namespace隔离

```bash
# go run test.go 
$ ip a
1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
```

Namespace里除了环回口没有任何其它网络设备，与宿主机网络命名空间是隔离的。

### Cgroups

>Linux Cgroups (Control Groups )提供了对 一 组进程及将来子进程的资源限制、控制和统
>计的能力,这些资源包括 CPU 、内存、存储、网络等 。通过 Cgroups ,可以方便地限制某个进
>程的资源占用,并且可以实时地监控进程的监控和统计信息

#### cgroup

> 一个cgroup包含一组进程，可以将一组进程和一组subsystem关联起来。

#### subsystem

> subsystem是一组资源控制的模块，一般包含如下几项：
>
> - blkio设置对块设备(比如硬盘)输入输出的访问控制 。
> - cpu设置cgroup中进程的CPU被调度的策略。
> - cpuacct可以统计cgroup中进程的CPU占用 。
> - cpuset在多核机器上设置cgroup中进程可以使用的CPU和内存(此处内存仅使用于
>   NUMA架构) 。
> - devices控制cgroup中进程对设备的访问。
> - freezer用于挂起( suspend )和恢复( resume)cgroup中的进程。
> - memory用于控制cgroup中进程的内存占用。
> - net_ cls用于将 cgroup 中进程产生的网络包分类,以便 Linux 的 tc (traffic controller )可
>   以根据分类区分出来自某个 cgroup 的包并做限流或监控 。
> - net_prio设置 cgroup 中进程产生的网络流量的优先级 。
> - ns 这个subsystem 比较特殊,它的作用是使cgroup中的进程在新的 Namespace中fork
>   新进程(NEWNS)时,创建出一个新的cgroup ,这个cgroup包含新的Namespace中
>   的进程

查看系统内核支持哪些subsystem

```bash
# ubuntu系统
# apt-get install -y cgroup-tools

# lssubsys -a
cpuset
cpu,cpuacct
blkio
memory
devices
freezer
net_cls,net_prio
perf_event
hugetlb
pids
rdma
```

#### hierarchy

>hierarchy的功能是把一组cgroup 串成 一个树状的结构,一个这样的树便是一个
>hierarchy ,通过这种树状结构, Cgroups可以做到继承 。



这三个组件之间的关系：

- 系统在创建了新的 hierarchy 之后,系统中所有的进程都会加入这个 hierarchy 的 cgroup
  根节点,这个 cgroup 根节点是 hierarchy 默认创建的, 在这个 hierarchy 中创建
  的 cgroup 都是这个 cgroup 根节点的子节点。
-  一个subsystem只能附加到一个 hierarchy 上面。
-  一个hierarchy可以附加多个 subsystem。
-  一个进程可以作为多个 cgroup 的成员,但是这些 cgroup 必须在不同的hierarchy中 。
-  一个进程 fork 出子进程时,子进程是和父进程在同一个 cgroup 中的,也可以根据需要将其移动到其他 cgroup 中 。

#### 手动配置cgroups

1. 创建挂载一个hierarchy(cgroup树)

   ```bash
   # mkdir -p cgroup-test
   # mount -t cgroup -o none,name=cgroup-test cgroup-test ./cgroup-test
   # ls ./cgroup-test/
   cgroup.clone_children  cgroup.sane_behavior  release_agent
   cgroup.procs           notify_on_release     tasks
   ```

   这些文件是这个hierarchy中cgroup根节点的配置项，这些文件的含义如下：

   - cgroup.clone_children, cpuset 的 subsystem 会读取这个配置文件,如果这个值是1(默
     认是0),子cgroup 才会继承父 cgroup 的 cpuset 的配置 。
   - cgroup.procs 是树中 当前节点 cgroup 中的进程组 ID ,现在的位置是在根节点,这个文
     件中会有现在系统中所有进程组的 ID 。
   - notify_on_release和 release_agent 会一起使用。 notify_ on _release 标识当这个 cgroup 最
     后一个进程退出的时候是否执行了release_ agent; release_ agent 则是 一 个路径,通常
     用作进程退出之后自动清理掉不再使用的 cgroup。
   - tasks 标识 该 cgroup 下面的进程 ID ,如果把一个进程 ID 写到 tasks 文件中,便会将相
     应的进程加入到这个 cgroup 中 。

2. 在cgroup根节点上创建两个子cgroup

   ```bash
   # cd cgroup-test/
   # mkdir cgroup-1 cgroup-2
   # tree
   .
   ├── cgroup-1
   │   ├── cgroup.clone_children
   │   ├── cgroup.procs
   │   ├── notify_on_release
   │   └── tasks
   ├── cgroup-2
   │   ├── cgroup.clone_children
   │   ├── cgroup.procs
   │   ├── notify_on_release
   │   └── tasks
   ├── cgroup.clone_children
   ├── cgroup.procs
   ├── cgroup.sane_behavior
   ├── notify_on_release
   ├── release_agent
   └── tasks
   
   2 directories, 14 files
   ```

   在cgroup目录下创建文件目录，会自动识别为这个cgroup的子cgroup，继承父cgroup的属性。

3. 往cgroup中添加/移动进程

   ```bash
   # cd cgroup-1/
   # echo $$
   58743
   # sudo sh -c "echo $$" >> tasks 
   # cat /proc/58743/cgroup 
   13:name=cgroup-test:/cgroup-1
   12:pids:/user.slice/user-1000.slice/user@1000.service
   11:devices:/user.slice
   10:hugetlb:/
   9:freezer:/
   8:cpuset:/
   7:memory:/user.slice/user-1000.slice/user@1000.service
   6:rdma:/
   5:net_cls,net_prio:/
   4:perf_event:/
   3:cpu,cpuacct:/user.slice
   2:blkio:/user.slice
   1:name=systemd:/user.slice/user-1000.slice/user@1000.service/gnome-launched-jetbrains-goland.desktop-38417.scope
   0::/user.slice/user-1000.slice/user@1000.service/gnome-launched-jetbrains-goland.desktop-38417.scope
   ```

   进程58743已经加到cgroup-test:/cgroup-1中。

4. subsystem限制cgroup中进程的资源

   ```bash
   # 上面创建hierarchy的时候，没有关联任何的subsystem，所以没办法通过上面那个hierarchy中的cgroup限
   # 制进程的资源，但是系统默认为每个subsystem创建一个默认的hierarchy，如：memory的hierarchy
   # mount | grep memory
   cgroup on /sys/fs/cgroup/memory type cgroup (rw,nosuid,nodev,noexec,relatime,memory)
   ```

   /sys/fs/cgroup/memory目录挂载在memory subsystem的hierarchy，可以通过在这个hierarchy中创建cgroup，限制进程占用的内存。

   ```bash
   # cd /sys/fs/cgroup/memory/
   # pwd
   /sys/fs/cgroup/memory
   
   #  未做任何限制下，启动一个占用内存的stress进程
   # stress --vm-bytes 200m --vm-keep -m 1
   stress: info: [71789] dispatching hogs: 0 cpu, 0 io, 1 vm, 0 hdd
   
   # top查看，96314M*0.2%~=200M
   进程号 USER      PR  NI    VIRT    RES    SHR    %CPU  %MEM     TIME+ COMMAND    
   71790 root      20   0  208660 204932    272 R 100.0   0.2   1:45.55 stress
   ```

   ```bash
   #设置cgroup限制
   # mkdir test-limit-memory 
   # cd test-limit-memory/
   #设置cgroup最大内存占用为100M
   # sh -c "echo "100m" > memory.limit_in_bytes"
   #当前进程移动到这个cgroup中
   # sh -c "echo $$ > tasks"
   #再次启用stress进程
   # stress --vm-bytes 200m --vm-keep -m 1
   stress: info: [72093] dispatching hogs: 0 cpu, 0 io, 1 vm, 0 hdd
   
   # top再次查看，96314M*0.1%~=100M
   进程号 USER      PR  NI    VIRT    RES    SHR    %CPU  %MEM     TIME+ COMMAND 
   72097 root      20   0  208660 101280    272 R  53.5   0.1   0:08.71 stress
   ```

​		stress进程内存被限制在100M以下了。

#### Go实现cgroup限制资源

在上面Go实现Namespace的基础上，再加上cgroup的限制，限制进程的内存使用

```bash
package main

import (
    "fmt"
    "io/ioutil"
    "os"
    "os/exec"
    "path"
    "strconv"
    "syscall"
)

const cgroupMemoryHierarchyMount = "/sys/fs/cgroup/memory"

func main() {
    if os.Args[0] == "/proc/self/exe" {
        // 内部容器pid
        fmt.Printf("container internal pid: %d", syscall.Getpid())
        fmt.Println()
        cmd := exec.Command("sh", "-c", `stress --vm-bytes 200m --vm-keep -m 1`)
        cmd.SysProcAttr = &syscall.SysProcAttr{
        }
        cmd.Stdin = os.Stdin
        cmd.Stdout = os.Stdout
        cmd.Stderr = os.Stderr

        if err := cmd.Run(); err != nil {
            fmt.Println(err)
            os.Exit(1)
        }
    }
    //这是一个link,当进程访问此链接时，就会访问这个进程本身的/proc/pid目录
    // /proc/pid/exe代表当前程序
    cmd := exec.Command("/proc/self/exe")
    cmd.SysProcAttr = &syscall.SysProcAttr{
        Cloneflags: syscall.CLONE_NEWUTS |
            syscall.CLONE_NEWIPC |
            syscall.CLONE_NEWPID |
            syscall.CLONE_NEWNS |
            syscall.CLONE_NEWUSER |
            sys96314M*0.1%~=100Mcall.CLONE_NEWNET,
    }
    //cmd.SysProcAttr.Credential = &syscall.Credential{
    //	Uid: uint32(1),
    //	Gid: uint32(1),
    //}
    cmd.Stdin = os.Stdin
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr

    if err := cmd.Start(); err != nil {
        fmt.Println(err)
        os.Exit(1)
    } else {
        // fork出来的进程映射在宿主机上的进程pid
        fmt.Printf("mapping to external pid: %v\n", cmd.Process.Pid)
        // 在系统默认memory subsystem hierarchy上创建cgroup
        targetDir := path.Join(cgroupMemoryHierarchyMount, "testmemorylimit")
        os.Mkdir(targetDir, 0755)
        // 容器进程加入cgroup
        ioutil.WriteFile(path.Join(targetDir, "tasks"), []byte(strconv.Itoa(cmd.Process.Pid)), 0644)
        // 限制cgroup进程内存
        ioutil.WriteFile(path.Join(targetDir, "memory.limit_in_bytes"), []byte("100m"), 0644)
    }
    cmd.Process.Wait()
}
```

使用top 查看，96314M*0.1%~=100M，cgroup限制内存有效

```bash
进程号 USER      PR  NI    VIRT    RES    SHR    %CPU  %MEM     TIME+ COMMAND 
123468 root      20   0  208660  96888    272 D  50.5   0.1   0:06.05 stress 
```

### Union File System

>Union File System ,简称 UnionFS , 是一种为 Linux 、 FreeBSD 和 NetBSD 操作系统设计的,
>把其他文件系统联合到 一个联合挂载点的文件系统服务 。它使用 branch 把不同文件系统的文件和目录“透明地”覆盖,形成 一个单 一一 致的文件系统 。 这些 branch 或者是 read-only 的 ,
>或者是 read-write 的,所以当对这个虚拟后的联合文件系统进行写操作 的时 候 , 系统是真正写
>到了 一个新的文件中 。 看起来这个虚拟后的联合文件系统是可以对任何文件进行操作的 , 但是
>其实它并没有改变原来的文件,这是因为 unionfs 用到了 一个重要的资源管理技术, 叫 写时复制。

>写时复制( copy-on-write ,下文简称 CoW ),也 叫 隐式共享 , 是 一种对可修改资源实现高
>效复制的资源管理技术 。 它的思想是,如果一个资源是重复的,但没有任何修改,这时并不需
>要立即创建一个新的资源 , 这个资源可以被新旧实例共享 。 创建新资源发生在第 一 次写操作,
>也就是对资源进行修改的时候 。 通过这种资源共享的方式,可以显著地减少未修改资源复制带
>来的消耗 , 但是也会在进行资源修改时增加小部分的开销。

>AUFS 完全重写了早期的 UnionFS 1 .x ,其主要目的是为了可靠性和性能 , 井且引入了 一 些新的功能,比
>如可写分支的负载均衡 。 AUFS的 一 些实现已经被纳入 UnionFS 2.x 版本。

#### docker aufs实现

> 宿主机上的/var/lib/docker/aufs/diff目录下存储着image层的数据，/var/lib/docker/aufs/layers目录存储着这些image层的metadata.

```bash
#没有任何docker image的情况下
# tree  /var/lib/docker/aufs/
/var/lib/docker/aufs/
├── diff
├── layers
└── mnt

# docker pull ubuntu
Using default tag: latest
latest: Pulling from library/ubuntu
d72e567cc804: Downloading 
0f3630e5ff08: Download complete 
b6a83d81d1f4: Download complete 
latest: Pulling from library/ubuntu
d72e567cc804: Pull complete 
0f3630e5ff08: Pull complete 
b6a83d81d1f4: Pull complete 
Digest: sha256:bc2f7250f69267c9c6b66d7b6a81a54d3878bb85f1ebb5f951c896d13e6ba537
Status: Downloaded newer image for ubuntu:latest
docker.io/library/ubuntu:latest
```


从拉取镜像的过程来看，ubuntu:latest镜像一共有3层，/var/lib/docker/aufs/*目录下也有三个文件目录

```bash
# ll /var/lib/docker/aufs/diff/
总用量 20
drwx------  5 root root 4096 10月 13 11:40 ./
drwx------  5 root root 4096 10月 13 11:28 ../
drwxr-xr-x 17 root root 4096 10月 13 11:40 35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f/
drwxr-xr-x  5 root root 4096 10月 13 11:40 3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942/
drwxr-xr-x  3 root root 4096 10月 13 11:40 672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c/

# ll /var/lib/docker/aufs/mnt/
总用量 20
drwx------ 5 root root 4096 10月 13 11:40 ./
drwx------ 5 root root 4096 10月 13 11:28 ../
drwxr-xr-x 2 root root 4096 10月 13 11:40 35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f/
drwxr-xr-x 2 root root 4096 10月 13 11:40 3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942/
drwxr-xr-x 2 root root 4096 10月 13 11:40 672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c/

# ll /var/lib/docker/aufs/layers/
总用量 16
drwx------ 2 root root 4096 10月 13 11:40 ./
drwx------ 5 root root 4096 10月 13 11:28 ../
-rw-r--r-- 1 root root    0 10月 13 11:40 35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f
-rw-r--r-- 1 root root   65 10月 13 11:40 3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942
-rw-r--r-- 1 root root  130 10月 13 11:40 672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c
```

从结果上看，layer id与layer文件夹名字不相同



为了看到镜像分层的效果，基于ubuntu镜像添加一个文件

```bash
# vim Dockerfile
FROM ubuntu
RUN echo "Hello world" > /tmp/newfile
 
# docker build -t changed-ubuntu .
Sending build context to Docker daemon  18.11MB
Step 1/2 : FROM ubuntu
 ---> 9140108b62dc
Step 2/2 : RUN echo "Hello world" > /tmp/newfile
 ---> Running in 7c37af40b107
Removing intermediate container 7c37af40b107
 ---> 1d4a0350f5af
Successfully built 1d4a0350f5af
Successfully tagged changed-ubuntu:latest

# docker images
REPOSITORY          TAG                 IMAGE ID            CREATED             SIZE
changed-ubuntu      latest              1d4a0350f5af        6 seconds ago       72.9MB
ubuntu              latest              9140108b62dc        2 weeks ago         72.9MB
# docker history changed-ubuntu:latest 
IMAGE               CREATED             CREATED BY                                      SIZE                COMMENT
1d4a0350f5af        14 seconds ago      /bin/sh -c echo "Hello world" > /tmp/newfile    12B                 
9140108b62dc        2 weeks ago         /bin/sh -c #(nop)  CMD ["/bin/bash"]            0B                  
<missing>           2 weeks ago         /bin/sh -c mkdir -p /run/systemd && echo 'do…   7B                  
<missing>           2 weeks ago         /bin/sh -c [ -z "$(apt-get indextargets)" ]     0B                  
<missing>           2 weeks ago         /bin/sh -c set -xe   && echo '#!/bin/sh' > /…   811B                
<missing>           2 weeks ago         /bin/sh -c #(nop) ADD file:da80f59399481ffc3…   72.9MB   
```

再次查看/var/lib/docker/aufs目录下的文件目录，多了1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625

```bash
# ll /var/lib/docker/aufs/diff/
总用量 24
drwx------  6 root root 4096 10月 13 14:01 ./
drwx------  5 root root 4096 10月 13 11:28 ../
drwxr-xr-x  3 root root 4096 10月 13 14:01 1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625/
drwxr-xr-x 17 root root 4096 10月 13 11:40 35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f/
drwxr-xr-x  5 root root 4096 10月 13 11:40 3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942/
drwxr-xr-x  3 root root 4096 10月 13 11:40 672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c/

# ll /var/lib/docker/aufs/mnt/docker aufs的layer id如何计算的
总用量 24
drwx------ 6 root root 4096 10月 13 14:01 ./
drwx------ 5 root root 4096 10月 13 11:28 ../
drwxr-xr-x 2 root root 4096 10月 13 14:01 1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625/
drwxr-xr-x 2 root root 4096 10月 13 11:40 35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f/
drwxr-xr-x 2 root root 4096 10月 13 11:40 3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942/
drwxr-xr-x 2 root root 4096 10月 13 11:40 672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c/

# ll /var/lib/docker/aufs/layers/
总用量 20
drwx------ 2 root root 4096 10月 13 14:01 ./
drwx------ 5 root root 4096 10月 13 11:28 ../
-rw-r--r-- 1 root root  195 10月 13 14:01 1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625
-rw-r--r-- 1 root root    0 10月 13 11:40 35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f
-rw-r--r-- 1 root root   65 10月 13 11:40 3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942
-rw-r--r-- 1 root root  130 10月 13 11:40 672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c

#查看1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625 layer的metadata，记录的是ubuntu镜像所使用的三层layer
# cat /var/lib/docker/aufs/layers/1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625 
672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c
3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942
35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f
```



查看多出来的这层layer内容，就是新增的/tmp/newfile

```bash
# cat  docker aufs的layer id如何计算的docker aufs的layer id如何计算的/var/lib/docker/aufs/diff/1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625/tmp/newfile 
Hello world
```

>docker 使用 AUFS 的 CoW 技术来实现 image layer 共享和减少磁盘空间占用 。cow 意味
>着 一旦某个文件只有很小的部分有改动, A旧S 也需要复制整个文件。这种设计会对容器性能
>产生一定的影响 ,尤其是在待 复制 的文件很大,或者位于很多 image layer 下方,又或者 AUFS
>需要深度搜索目录结构树 的时候 。不过也不用过度担心,对于 一个容器而 言 ,每个 image layer
>最多只需要复制 一 次。后续的改动都会在第一次拷贝的 container layer 上进行 。

>启动 一 个 container 的时候, Docker 会为其创建一个 read-only 的 init layer ,用来存储与这
>个容器内环境相关的内容: Docker 还会为其创建一个 read-write 的 layer 来执行所有写操作。

>container layer 的 mount 目 录 也是 /var/lib/docker/aufs/mnt 。 container 的 metadata 和配置文
件都存放在/var/lib/docker/containers/<container-id>目录中。 container 的 read-write layer 存储在
/var/lib/docker/aufs/diff/ 目 录下。即使容器停止 ,这个可读写层仍然存在,因而重启容器不会丢
失数据,只有当 一个容器被删除的时候,这个可读写层才会一起删除。

```bash
# docker ps -a 
CONTAINER ID        IMAGE               COMMAND             CREATED             STATUS              PORTS               NAMES
# ll /var/lib/docker/containers/
总用量 8
drwx------  2 root root 4096 10月 13 14:01 ./
drwx--x--x 15 root root 4096 10月 13 11:28 ../

# ls /sys/fs/aufs/
config
```

启动一个容器docker aufs的layer id如何计算的

```bash
# docker run -dit changed-ubuntu bash
0eba29db16ba28a8bad5fb232733b14b9f20fbc571f4e64bd62a70c6225d3090
# docker ps -a
CONTAINER ID        IMAGE               COMMAND             CREATED             STATUS              PORTS               NAMES
0eba29db16ba        changed-ubuntu      "bash"              7 seconds ago       Up 6 seconds                            zen_feistel
```

```bash
# ll /var/lib/docker/aufs/diff/
总用量 32
drwx------  8 root root 4096 10月 13 14:46 ./
drwx------  5 root root 4096 10月 13 11:28 ../
drwxr-xr-x  3 root root 4096 10月 13 14:01 1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625/
drwxr-xr-x  4 root root 4096 10月 13 14:46 26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3/
drwxr-xr-x  6 root root 4096 10月 13 14:46 26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3-init/
drwxr-xr-x 17 root root 4096 10月 13 11:40 35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f/
drwxr-xr-x  5 root root 4096 10月 13 11:40 3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942/
drwxr-xr-x  3 root root 4096 10月 13 11:40 672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c/

# ll /var/lib/docker/aufs/mnt/
总用量 32
drwx------  8 root root 4096 10月 13 14:46 ./
drwx------  5 root root 4096 10月 13 11:28 ../
drwxr-xr-x  2 root root 4096 10月 13 14:01 1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625/
drwxr-xr-x 28 root root 4096 10月 13 14:46 26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3/
drwxr-xr-x  2 root root 4096 10月 13 14:46 26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3-init/
drwxr-xr-x  2 root root 4096 10月 13 11:40 35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f/
drwxr-xr-x  2 root root 4096 10月 13 11:40 3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942/
drwxr-xr-x  2 root root 4096 10月 13 11:40 672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c/


```

多了26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3-init和26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3两个目录；

- 26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3-init: docker为容器创建的read-only的init layer

- 26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3: docker为容器创建的read-write layer

查看layers依赖

```bash
# ll /var/lib/docker/aufs/layers/
总用量 28
drwx------ 2 root root 4096 10月 13 14:46 ./
drwx------ 5 root root 4096 10月 13 11:28 ../
-rw-r--r-- 1 root root  195 10月 13 14:01 1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625
-rw-r--r-- 1 root root  330 10月 13 14:46 26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3
-rw-r--r-- 1 root root  260 10月 13 14:46 26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3-init
-rw-r--r-- 1 root root    0 10月 13 11:40 35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f
-rw-r--r-- 1 root root   65 10月 13 11:40 3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942
-rw-r--r-- 1 root root  130 10月 13 11:40 672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c

# cat /var/lib/docker/aufs/layers/26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3
26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3-init  # 依赖read-only的init layer
1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625
672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c
3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942
35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f
 
# cat /var/lib/docker/aufs/layers/26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3-init 
1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625
672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c
3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942
35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f
```



/var/lib/docker/containers/目录下生成一个与container-id相同的目录，里面记录着容器的metadata和config

```bash
# ll /var/lib/docker/containers/0eba29db16ba28a8bad5fb232733b14b9f20fbc571f4e64bd62a70c6225d3090
总用量 40
drwx------ 4 root root 4096 10月 13 14:46 ./
drwx------ 3 root root 4096 10月 13 14:46 ../
-rw-r----- 1 root root    0 10月 13 14:46 0eba29db16ba28a8bad5fb232733b14b9f20fbc571f4e64bd62a70c6225d3090-json.log
drwx------ 2 root root 4096 10月 13 14:46 checkpoints/
-rw------- 1 root root 2520 10月 13 14:46 config.v2.json
-rw-r--r-- 1 root root 1470 10月 13 14:46 hostconfig.json
-rw-r--r-- 1 root root   13 10月 13 14:46 hostname
-rw-r--r-- 1 root root  174 10月 13 14:46 hosts
drwx------ 2 root root 4096 10月 13 14:46 mounts/
-rw-r--r-- 1 root root  729 10月 13 14:46 resolv.conf
-rw-r--r-- 1 root root   71 10月 13 14:46 resolv.conf.hash
```



查看aufs mount情况

```bash
# mount |grep 26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3
none on /var/lib/docker/aufs/mnt/26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3 type aufs (rw,relatime,si=69c407a4971c1edb,dio,dirperm1)

# cat /sys/fs/aufs/si_69c407a4971c1edb/*
/var/lib/docker/aufs/diff/26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3=rw
/var/lib/docker/aufs/diff/26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3-init=ro+wh
/var/lib/docker/aufs/diff/1f98fd35a5db663a2c5ff94f5886a265651f0b83ab2360474302bfd9658cd625=ro+wh
/var/lib/docker/aufs/diff/672e85f22cd3f9a8d1e1de4af254f5b5df6e09c5e2ed20d84aea922846f8f62c=ro+wh
/var/lib/docker/aufs/diff/3e879061e2198d553c6a300da06d1e22ad337298d5450d29106617d9d1c2f942=ro+wh
/var/lib/docker/aufs/diff/35e57c8eb9d579a309f561e5fd688b682a4d87e92437f6db087c60034a24bb7f=ro+wh
64
65
66
67
68
69
/dev/shm/aufs.xino
```

清楚地记录了容器依赖的image layer的权限，只有26984207c99db458de0742245af5239d7996d5ed9ba60459e94297263f4d7ca3是rw权限

>note: AUFS 如何为 container删 除一个文件。如果要删除file1, AUFS 会在
>container的read-write层生成一个.wh.file1的文件来隐藏所有 read-only 层的file1文件。



#### 手动实现aufs

1. 创建aufs目录及相关文件

```bash
# pwd
/root
# mkdir -p aufs
# mkdir -p aufs/{container-layer,image-layer1,image-layer2,image-layer3,image-layer4,mnt}
# echo "container layer" > aufs/container-layer/container-layer.txt
# echo "image layer2" > aufs/image-layer2/image-layer2.txt
# echo "image layer3" > aufs/image-layer3/image-layer3.txt
# echo "image layer1" > aufs/image-layer1/image-layer1.txt
# echo "image layer4" > aufs/image-layer4/image-layer4.txt
# tree aufs/
aufs/
├── container-layer.txt
├── image-layer1
│   └── image-layer1.txt
├── image-layer2
│   └── image-layer2.txt
├── image-layer3
│   └── image-layer3.txt
├── image-layer4
│   └── image-layer4.txt
└── mnt

5 directories, 5 files
```

2. 挂载aufs，默认dirs指定的左边第一个目录是rw权限，后面的都是ro权限

```bash
# cd aufs/
# mount -t aufs -o dirs=./container-layer:./image-layer4:./image-layer3:./image-layer2:./image-layer1 none ./mnt/ 
# tree  mnt/
mnt/
├── container-layer.txt
├── image-layer1.txt
├── image-layer2.txt
├── image-layer3.txt
└── image-layer4.txt

0 directories, 5 files
```

```bash
# mount
none on /root/aufs/mnt type aufs (rw,relatime,si=69c407b0f6b5eedb)

# cat /sys/fs/aufs/si_69c407b0f6b5eedb/*
/root/aufs/container-layer=rw
/root/aufs/image-layer4=ro
/root/aufs/image-layer3=ro
/root/aufs/image-layer2=ro
/root/aufs/image-layer1=ro
64
65
66
67
68
/root/aufs/container-layer/.aufs.xino
```

从结果中看到只有container-layer是rw的

3. 往mnt/image-layer4写

```bash
# echo "write test" >> ./mnt/image-layer4.txt 
# cat ./mnt/image-layer4.txt 
image layer4
write test

# cat image-layer4/image-layer4.txt 
image layer4

# cat container-layer/image-layer4.txt 
image layer4
write test
```
查看image-layer4内容并未发生改变，container-layer目录下多了一个image-layer4.txt的文件。当尝试向 mnt/image-layer4.txt 文件进行写操作的时候 , 系统首先在 mnt 目录下查找名为 image-layer4.txt 的 文件 ,将其拷贝到 read-write 层的 container-layer 目录中,接着对container-layer 目录中的 image-layer4.txt 文件进行写操作 。


### 构造容器

/proc比较重要的部分：

- /proc/N PID 为 N 的进程信息
- /proc/N/cmdline 进程启动命令
- /proc/N/cwd 链接到进程当前工作目录
- /proc/N/environ 进程环境变量列表
- /proc/N/exe 链接到进程的执行命令文件
- /proc/N/fd 包含进程相关的所有文件描述符
- /proc/N/maps 与进程相关 的内存映射信息
- /proc/N/mem 指代进程持有的内存,不可读
- /proc/N/root 链接到进程的根目录
- /proc/N/stat 进程的状态git config --global user.name "Your Name"
- /proc/N/statm 进程使用的内存状态
- /proc/N/status 进程状态信息,比 stat/statm 更具可读性
- /proc/self/ 链接到当前正在运行的进程

模拟docker demo实现：[https://github.com/yaoice/idocker](https://github.com/yaoice/idocker)


