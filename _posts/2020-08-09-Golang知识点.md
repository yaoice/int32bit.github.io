---
layout: post
title: Golang知识点
subtitle: ""
catalog: true
hide: false
tags:
     - Go
---

### defer 7个知识点

1. defer的执行顺序

    有多个defer的时候，是按照栈的关系来执行

2. defer与return谁先谁后

    return之后的语句先执行，defer后的语句后执行
    
3. 函数的返回值初始化与defer间接影响

    只要声明函数的返回值变量名称，就会在函数初始化时候为之赋值为0，而且在函数体作用域可见
    
4. 有名函数返回值遇见defer情况

    通过知识点2得知，先return，再defer，所以在执行完return之后，还要再执行defer里的语句，依然可以修改本应该返回的结果

5. defer遇见panic

    遇到panic时，遍历本协程的defer链表，并执行defer。在执行defer过程中:遇到recover则停止panic，返回recover处继续往下执行。如果没有遇到recover，遍历完本协程的defer链表后，向stderr抛出panic信息

6. defer中包含panic

    panic仅有最后一个可以被revover捕获

7. defer下的函数参数包含子函数    
        
### atomic.Value vs sync.Mutex

原子操作由底层硬件支持，而锁则由操作系统的调度器实现。锁应当用来保护一段逻辑，对于一个变量更新的保护，原子操作通常会更有效率，并且更能利用计算机多核的优势，
如果要更新的是一个复合对象，则应当使用atomic.Value封装好的实现。

### 进程 vs 线程 vs 协程

进程
>进程是系统资源分配的最小单位, 进程包括文本段text region、数据段data region和堆栈段stack region等。
进程的创建和销毁都是系统资源级别的，因此是一种比较昂贵的操作，
进程是抢占式调度其有三个状态:等待态、就绪态、运行态。进程之间是相互隔离的，
它们各自拥有自己的系统资源, 更加安全但是也存在进程间通信不便的问题。
     
线程    
>进程是线程的载体容器，多个线程除了共享进程的资源还拥有自己的一少部分独立的资源，
>因此相比进程而言更加轻量，进程内的多个线程间的通信比进程容易，但是也同样带来了同步和互斥的问题和线程安全问题，
>尽管如此多线程编程仍然是当前服务端编程的主流，线程也是CPU调度的最小单位，多线程运行时就存在线程切换问题

协程
>协程在有的资料中称为微线程或者用户态轻量级线程，协程调度不需要内核参与而是完全由用户态程序来决定，
>因此协程对于系统而言是无感知的。协程由用户态控制就不存在抢占式调度那样强制的CPU控制权切换到其他进线程，
>多个协程进行协作式调度，协程自己主动把控制权转让出去之后，其他协程才能被执行到，
>这样就避免了系统切换开销提高了CPU的使用效率。

小结
- 进程/线程抢占式调度由系统内核调度，成本大效率低
- 协程协作式调度由用户态调度，成本低效率高 

如果有大量的协程，何时让出控制权，何时恢复执行？忽然明白了抢占式调度的优势了，在抢占式调度中都是由系统内核来完成的。
我们需要一个"用户态协程调度器". Golang Goroutine是如何解决的呢？

Golang GPM模型使用一种M:N的调度器来调度任意数量的协程运行于任意数量的系统线程中，
从而保证了上下文切换的速度并且利用多核，但是增加了调度器的复杂度。

引用网络上的一张图
<img src="/img/posts/2020-08-09/golang_gpm.png"/>

GPM调度过程简述：
>新创建的Goroutine会先存放在Global全局队列中，等待Go调度器进行调度，
 随后Goroutine被分配给其中的一个逻辑处理器P，并放到这个逻辑处理器对应的Local本地运行队列中，
 最终等待被逻辑处理器P执行即可。
>在M与P绑定后，M会不断从P的Local队列中无锁地取出G，并切换到G的堆栈执行，
 当P的Local队列中没有G时，再从Global队列中获取一个G，当Global队列中也没有待运行的G时，
 则尝试从其它的P窃取部分G来执行相当于P之间的负载均衡。
 

### 读写锁 vs 互斥锁 vs 死锁

死锁
>两个或两个以上进程竞争资源造成的一种阻塞现象

golang 中的 sync 包实现了两种锁：

- Mutex：互斥锁
- RWMutex：读写锁，RWMutex 基于 Mutex 实现

Mutex（互斥锁）
>
- Mutex 为互斥锁，Lock() 加锁，Unlock() 解锁
- 在一个 goroutine 获得 Mutex 后，其他 goroutine 只能等到这个 goroutine 释放该 Mutex
- 使用 Lock() 加锁后，不能再继续对其加锁，直到利用 Unlock() 解锁后才能再加锁
- 在 Lock() 之前使用 Unlock() 会导致 panic 异常
- 已经锁定的 Mutex 并不与特定的 goroutine 相关联，这样可以利用一个 goroutine 对其加锁，再利用其他 goroutine 对其解锁
- 在同一个 goroutine 中的 Mutex 解锁之前再次进行加锁，会导致死锁
- 适用于读写不确定，并且只有一个读或者写的场景

RWMutex（读写锁）
>
- RWMutex 是单写多读锁，该锁可以加多个读锁或者一个写锁
- 读锁占用的情况下会阻止写，不会阻止读，多个 goroutine 可以同时获取读锁
- 写锁会阻止其他 goroutine（无论读和写）进来，整个锁由该 goroutine 独占
- 适用于读多写少的场景
- Lock() 加写锁，Unlock() 解写锁
- 如果在加写锁之前已经有其他的读锁和写锁，则 Lock() 会阻塞直到该锁可用，为确保该锁可用，已经阻塞的 Lock() 调用会从获得的锁中排除新的读取器，即写锁权限高于读锁，有写锁时优先进行写锁定
- 在 Lock() 之前使用 Unlock() 会导致 panic 异常
- RLock() 加读锁，RUnlock() 解读锁
- RLock() 加读锁时，如果存在写锁，则无法加读锁；当只有读锁或者没有锁时，可以加读锁，读锁可以加载多个
- RUnlock() 解读锁，RUnlock() 撤销单词 RLock() 调用，对于其他同时存在的读锁则没有效果
- 在没有读锁的情况下调用 RUnlock() 会导致 panic 错误
- RUnlock() 的个数不得多余 RLock()，否则会导致 panic 错误

### 参考链接

- [golang中的defer必掌握的7知识点golang中的defer必掌握的7知识点](https://www.dailybtc.cn/golang%e4%b8%ad%e7%9a%84defer%e5%bf%85%e6%8e%8c%e6%8f%a1%e7%9a%847%e7%9f%a5%e8%af%86%e7%82%b9golang%e4%b8%ad%e7%9a%84defer%e5%bf%85%e6%8e%8c%e6%8f%a1%e7%9a%847%e7%9f%a5%e8%af%86%e7%82%b9/)
- [Go 语言标准库中 atomic.Value 的前世今生](https://blog.betacat.io/post/golang-atomic-value-exploration/)
- [浅谈协程和Go语言的Goroutine](https://juejin.im/post/6844904056918376456)
