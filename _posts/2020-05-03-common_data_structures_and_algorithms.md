---
layout: post
title: 常用数据结构与算法
subtitle: ""
catalog: true
hide: true
tags:
     - Go
---

### 算法复杂度

#### 时间复杂度

大O复杂度表示法: 表示代码执行时间随数据规模增长的变化趋势

```
T(n) = O(f(n))
```

时间复杂度分析
- 只关注循环次数最多的那段代码
- 加法法则，总复杂度等于量级最大的那段代码的复杂度
- 乘法法则，嵌套代码的复杂度等于嵌套内外代码复杂度的乘积

常见时间复杂度量级(按数量级递增)：

- 多项式量级

    - 常量阶 O(1)
    - 对数阶 O(logN)
    - 线性阶 O(n)
    - 线性对数阶 O(nlogN)
    - 平方阶 O(n^2) O(n^3)  O(n^k) 

- 非多项式量级

    - 指数阶 O(2^n)
    - 阶乘阶 O(n!)

#### 空间复杂度

表示算法 的存储空间与数据规模之间的增⻓关系

空间复杂度分析
常⻅的空间复杂度有：
- O(1)
- O(n)
- O(n2 )

像O(logn)、O(nlogn)对数阶复杂度一般都用不到；空间复杂度分析比时间复杂度分析简单


#### 进阶复杂度分析

- 最好情况时间复杂度
- 最坏情况时间复杂度
- 平均情况时间复杂度
- 均摊时间复杂度

### 常见数据结构

#### 数组

```
package main

import (
    "errors"
    "fmt"
)

/**
 * 1) 数组的插入、删除、按照下标随机访问操作；
 * 2）数组中的数据是int类型的；
 *
 */

type Array struct {
    data []int
    length uint
}

func NewArray(capacity uint) *Array {
    if capacity == 0 {
        return nil
    }
    return &Array{
        data:   make([]int, capacity, capacity),
        length: 0,
    }
}

func (a *Array) Len() uint {
    return a.length
}

// 越界
func (a *Array) OutOfCap(index uint) error {
    if index >= uint(cap(a.data)) {
        return errors.New("out of cap")
    }
    return nil
}

// 插入
func (a *Array) Insert(index uint, v int) error {
    if a.Len() == uint(cap(a.data)) {
        return errors.New("full cap")
    }

    // 是否越界
    if err := a.OutOfCap(index); err != nil {
        return err
    }

    for i:=a.Len(); i>index; i-- {
        a.data[i] = a.data[i-1]
    }
    a.data[index] = v
    a.length++
    return nil
}

// 删除
func (a *Array) Delete(index uint) error {
    // 是否越界
    if err := a.OutOfCap(index); err != nil {
        return err
    }
    for i:=index; i<a.Len()-1; i++{
        a.data[i] = a.data[i+1]
    }
    a.data[a.Len()-1] = 0
    a.length--
    return nil
}

// 按照下标随机访问
func (a *Array) Find(index uint) (*int, error) {
    if err := a.OutOfCap(index); err != nil {
        return nil, err
    }
    findInt := a.data[index]
    return &findInt, nil
}

// 遍历
func (a *Array) Print() {
    for i := uint(0); i < uint(cap(a.data)); i++ {
        fmt.Println(a.data[i])
    }
}

func main() {
    testArray := NewArray(10)
    testArray.Insert(0, 0)
    testArray.Insert(1, 1)
    testArray.Insert(2, 2)
    testArray.Insert(3, 3)
    testArray.Delete(2)
    testArray.Print()
}
```
数组用一块连续的内存空间，来存储相同类型的一组数据，最大的特点就是支持随机访问，但插入、删除操作也因此变得比较低效，平均情况时间复杂度为O(n)

#### 单向链表

链表插入/删除平均情况时间复杂度为O(1)，随机访问平均时间复杂度为O(n)
```
package main

import (
    "fmt"
)

/*
 * 单向链表基本操作
 */

type LinkedNode struct {
    value int
    next  *LinkedNode
}

type LinkedList struct {
    head   *LinkedNode
    length uint
}

func (l *LinkedList) Len() uint {
    return l.length
}

// 之后插入
func (l *LinkedList) InsertAfter(p *LinkedNode, v int) bool {
    if p == nil {
        return false
    }
    originNext := p.next
    linkedNode := &LinkedNode{
        value: v,
        next:  originNext,
    }
    p.next = linkedNode
    l.length++
    return true
}

// 之前插入
func (l *LinkedList) InsertBefore(p *LinkedNode, v int) bool {
    if p == nil {
        return false
    }

    current := l.head
    for current.next != nil {
        if current.next == p {
            break
        }
        current = current.next
    }
    linkedNode := &LinkedNode{
        value: v,
        next:  p,
    }
    current.next = linkedNode
    l.length++
    return true
}

// 删除
func (l *LinkedList) Delete(p *LinkedNode) bool {
    current := l.head
    if current == p {
        l.head = current.next
        l.length--
        return true
    }
    for current.next != nil {
        if current.next == p {
            break
        }
        current = current.next
    }
    if current.next == nil {
        return false
    }
    current.next = p.next
    l.length--
    return true
}

// 查找
func (l *LinkedList) Find(index int) *LinkedNode {
    current := l.head
    for i := 0; i < index-1; i++ {
        if current.next != nil {
            current = current.next
        }
    }
    return current
}

// 遍历
func (l *LinkedList) Print() {
    current := l.head
    for {
        fmt.Println(current.value)
        if current.next == nil {
            return
        }
        current = current.next
    }
}

func main() {
    n5 := &LinkedNode{value: 5, next: nil}
    n4 := &LinkedNode{value: 4, next: n5}
    n3 := &LinkedNode{value: 3, next: n4}
    n2 := &LinkedNode{value: 2, next: n3}
    n1 := &LinkedNode{value: 1, next: n2}

    linkedList := &LinkedList{
        head:   n1,
        length: 5,
    }

    linkedList.InsertBefore(n2, 222)
    linkedList.InsertAfter(n5, 222)

    tar := linkedList.Find(6)
    linkedList.Delete(tar)

    linkedList.Print()
}
```

#### 双向链表

双向链表，之前插入和删除，不需要再遍历了
```
package main

import (
    "fmt"
)

/*
 * 双向链表基本操作
 */

type LinkedNode struct {
    value int
    pre   *LinkedNode
    next  *LinkedNode
}

type LinkedList struct {
    head   *LinkedNode
    length uint
}

func (l *LinkedList) Len() uint {
    return l.length
}

// 之后插入
func (l *LinkedList) InsertAfter(p *LinkedNode, v int) bool {
    if p == nil {
        return false
    }
    lastNode := p.next
    linkedNode := &LinkedNode{
        pre: p,
        value: v,
        next: lastNode,
    }
    p.next = linkedNode
    lastNode.pre = linkedNode
    l.length++
    return true
}

// 之前插入
func (l *LinkedList) InsertBefore(p *LinkedNode, v int) bool {
    if p == nil {
        return false
    }
    preNode := p.pre
    linkedNode := &LinkedNode{
        value: v,
        pre:  preNode,
        next: p,
    }
    preNode.next = linkedNode
    p.pre = linkedNode
    l.length++
    return true
}

// 删除
func (l *LinkedList) Delete(p *LinkedNode) bool {
    // 首节点
    if l.head == p {
        l.head = p.next
        if p.next != nil {
            p.next.pre = nil
        }
        l.length--
        return true
    }
    // 尾节点
    if p.next == nil {
        preNode := p.pre
        preNode.next = nil
        l.length--
        return true
    }
    preNode := p.pre
    lastNode := p.next
    preNode.next = lastNode
    lastNode.pre = preNode
    l.length--
    return true
}

// 查找
func (l *LinkedList) Find(index int) *LinkedNode {
    current := l.head
    for i := 0; i < index-1; i++ {
        if current.next != nil {
            current = current.next
        }
    }
    return current
}

// 遍历
func (l *LinkedList) Print() {
    current := l.head
    for {
        fmt.Println(current.value)
        if current.next == nil {
            return
        }
        current = current.next
    }
}

func main() {
    n5 := &LinkedNode{value: 5, next: nil}
    n4 := &LinkedNode{value: 4, next: n5}
    n3 := &LinkedNode{value: 3, next: n4}
    n2 := &LinkedNode{value: 2, next: n3}
    n1 := &LinkedNode{value: 1, next: n2}

    n1.pre = nil
    n2.pre = n1
    n3.pre = n2
    n4.pre = n3
    n5.pre = n4

    linkedList := &LinkedList{
        head:   n1,
        length: 5,
    }

    linkedList.InsertBefore(n2, 222)
    linkedList.InsertAfter(n3, 222)
    tar := linkedList.Find(7)
    linkedList.Delete(tar)
    linkedList.Print()
}
```

#### 双向循环链表

```
package main

import (
    "fmt"
)

/*
 * 双向循环链表基本操作(约瑟夫问题)
 */

type LinkedNode struct {
    value int
    pre   *LinkedNode
    next  *LinkedNode
}

type LinkedList struct {
    head   *LinkedNode
    length uint
}

func (l *LinkedList) Len() uint {
    return l.length
}

// 之后插入
func (l *LinkedList) InsertAfter(p *LinkedNode, v int) bool {
    if p == nil {
        return false
    }
    lastNode := p.next
    linkedNode := &LinkedNode{
        pre: p,
        value: v,
        next: lastNode,
    }
    p.next = linkedNode
    lastNode.pre = linkedNode
    l.length++
    return true
}

// 之前插入
func (l *LinkedList) InsertBefore(p *LinkedNode, v int) bool {
    if p == nil {
        return false
    }
    preNode := p.pre
    linkedNode := &LinkedNode{
        value: v,
        pre:  preNode,
        next: p,
    }
    preNode.next = linkedNode
    p.pre = linkedNode
    l.length++
    return true
}

// 删除
func (l *LinkedList) Delete(p *LinkedNode) bool {
    if p.pre == p || p.next == p {
        l.head = nil
        l.length--
        return true
    }
    preNode := p.pre
    lastNode := p.next
    preNode.next = lastNode
    lastNode.pre = preNode
    if l.head == p {
        l.head = p.next
    }
    p.next = nil
    p.pre = nil
    p.value = 0
    l.length--
    return true
}

// 查找
func (l *LinkedList) Find(index int) *LinkedNode {
    current := l.head
    for i := 0; i < index-1; i++ {
        if current.next != nil {
            current = current.next
        }
    }
    return current
}

// 遍历
func (l *LinkedList) Print() {
    current := l.head
    for i:= 0; i<int(l.Len()); i++ {
        fmt.Println(current.value)
        if current.next == nil {
            return
        }
        current = current.next
    }
}

func main() {
    n5 := &LinkedNode{value: 5}
    n4 := &LinkedNode{value: 4}
    n3 := &LinkedNode{value: 3}
    n2 := &LinkedNode{value: 2}
    n1 := &LinkedNode{value: 1}

    n1.pre = n5
    n2.pre = n1
    n3.pre = n2
    n4.pre = n3
    n5.pre = n4

    n1.next = n2
    n2.next = n3
    n3.next = n4
    n4.next = n5
    n5.next = n1

    linkedList := &LinkedList{
        head:   n1,
        length: 5,
    }

    linkedList.InsertBefore(n2, 222)
    linkedList.InsertAfter(n3, 222)
    tar := linkedList.Find(1)
    linkedList.Delete(tar)
    linkedList.Print()
}
```

#### 进阶链表

- 单链表反转
- 链表中环的检测
- 两个有序的链表合并
- 删除链表倒数第n个结点
- 求链表的中间结点

```
// 反转
/*
 * 使用p和q两个指针配合工作，使得两个节点间的指向反向，同时用r记录剩下的链表
 */
func (l *LinkedList) Reverse() {
    if nil == l.head || nil == l.head.next {
        return
    }

    p := l.head
    q := p.next
    p.next = nil
    for {
        r := q.next
        q.next = p
        p = q
        q = r
        if r == nil {
            break
        }
    }
    l.head = p
}
```

#### 顺序栈

```
package main

import (
    "fmt"
)

/*
 * 基于数组的顺序栈
 */

type Stack struct {
    length int
    size int
    items []string
}

func (s *Stack) Len() int {
    return s.length
}

func NewStack(size int) *Stack {
    return &Stack{
        length: 0,
        size:   size,
        items:  make([]string, size),
    }
}

// 入栈
func (s *Stack) Push(item string) bool {
    if s.length == s.size {
        return false
    }
    s.items[s.length] = item
    s.length++
    return true
}

// 出栈
func (s *Stack) Pop() string {
    if s.length == 0 {
        return ""
    }
    item := s.items[s.length-1]
    s.items = s.items[:s.length-1]
    s.length--
    return item
}

// 遍历
func (s *Stack) Print() {
    for i:=0; i<s.length; i++ {
        fmt.Println(s.items[i])
    }
}

func main() {
    s := NewStack(10)
    s.Push("1")
    s.Push("2")
    s.Push("3")
    fmt.Println("origin:")
    s.Print()
    s.Pop()
    s.Pop()
    fmt.Println("now:")
    s.Print()
}
```

#### 链式栈

```
package main

import (
    "fmt"
)

/*
 * 基于链表的非顺序栈
 */

type LinkedNode struct {
    value int
    next  *LinkedNode
}

type Stack struct {
    head   *LinkedNode
    length int
    size int
}

func NewStack(head   *LinkedNode, size int) *Stack {
    return &Stack{
        head: head,
        length: 0,
        size:   size,
    }
}

func (s *Stack) Len() int {
    return s.length
}

// 入栈
func (s *Stack) Push(v int) bool {
    if s.length == s.size {
        return false
    }
    linkedNode := &LinkedNode{
        value: v,
        next:  nil,
    }
    if s.head == nil {
        s.head = linkedNode
        return true
    }
    tail := s.head
    for tail.next != nil {
        tail = tail.next
    }
    tail.next = linkedNode
    s.length++
    return true
}

// 出栈
func (s *Stack) Pop() *int {
    beforeTail := new(LinkedNode)
    tail := s.head
    if tail == nil {
        return nil
    }
    beforeTail = tail
    for tail.next != nil {
        beforeTail = tail
        tail = tail.next
    }
    beforeTail.next = nil
    s.length--
    return &tail.value
}

// 遍历
func (s *Stack) Print() {
    current := s.head
    for {
        fmt.Println(current.value)
        if current.next == nil {
            return
        }
        current = current.next
    }
}

func main() {
    n5 := &LinkedNode{value: 5, next: nil}
    n4 := &LinkedNode{value: 4, next: n5}
    n3 := &LinkedNode{value: 3, next: n4}
    n2 := &LinkedNode{value: 2, next: n3}
    n1 := &LinkedNode{value: 1, next: n2}

    s := NewStack(n1, 5)
    s.Push(6)
    s.Push(10)
    s.Push(11)
    s.Pop()
    s.Print()
}
```

#### 顺序队列

```
package main

import (
    "fmt"
)

/*
 * 基于数组的顺序队列
 */

type Queue struct {
    length int
    size int
    items []string
}

func (s *Queue) Len() int {
    return s.length
}

func NewQueue(size int) *Queue {
    return &Queue{
        length: 0,
        size:   size,
        items:  make([]string, size),
    }
}

// 入队列
func (s *Queue) Push(item string) bool {
    if s.length == s.size {
        return false
    }
    s.items[s.length] = item
    s.length++
    return true
}

// 出队列
func (s *Queue) Pop() string {
    if s.length == 0 {
        return ""
    }
    item := s.items[0]
    s.items = s.items[1:]
    s.length--
    return item
}

// 遍历
func (s *Queue) Print() {
    for i:=0; i<s.length; i++ {
        fmt.Println(s.items[i])
    }
}

func main() {
    s := NewQueue(10)
    fmt.Println("origin:")
    s.Push("1")
    s.Push("2")
    s.Push("3")
    s.Print()
    s.Pop()
    fmt.Println("now:")
    s.Print()
}
```

#### 链式队列

```
package main

import (
    "fmt"
)

/*
 * 基于链表的非顺序队列
 */

type LinkedNode struct {
    value int
    next  *LinkedNode
}

type Queue struct {
    head   *LinkedNode
    length int
    size int
}

func NewQueue(head   *LinkedNode, size int) *Queue {
    return &Queue{
        head: head,
        length: 0,
        size:   size,
    }
}

func (q *Queue) Len() int {
    return q.length
}

// 入队列
func (q *Queue) Push(v int) bool {
    if q.length == q.size {
        return false
    }
    linkedNode := &LinkedNode{
        value: v,
        next:  nil,
    }
    if q.head == nil {
        q.head = linkedNode
        return true
    }
    tail := q.head
    for tail.next != nil {
        tail = tail.next
    }
    tail.next = linkedNode
    q.length++
    return true
}

// 出队列
func (q *Queue) Pop() *int {
    if q.head == nil {
        return nil
    }
    popValue := q.head.value
    q.head = q.head.next
    q.length--
    return &popValue
}

// 遍历
func (q *Queue) Print() {
    current := q.head
    for {
        fmt.Println(current.value)
        if current.next == nil {
            return
        }
        current = current.next
    }
}

func main() {
    n5 := &LinkedNode{value: 5, next: nil}
    n4 := &LinkedNode{value: 4, next: n5}
    n3 := &LinkedNode{value: 3, next: n4}
    n2 := &LinkedNode{value: 2, next: n3}
    n1 := &LinkedNode{value: 1, next: n2}

    q := NewQueue(n1, 5)
    q.Push(6)
    q.Push(10)
    q.Push(11)
    q.Pop()
    q.Print()
}
```

#### 循环队列

基于数组实现的队列，在出队列的时候会有数据搬迁；循环队列可以不用数据搬迁

```
package main

import (
    "fmt"
)

/*
 * 基于数组的循环队列，分别用head、tail记录队列头部、尾部位置
 */

type Queue struct {
    size int
    head int
    tail int
    items []interface{}
}

func NewQueue(size int) *Queue {
    return &Queue{
        size:   size,
        head: 0,
        tail: 0,
        items:  make([]interface{}, size),
    }
}

// 是否满队列
func (s *Queue) IsFull() bool {
    if s.head == (s.tail+1) % s.size {
        return true
    }
    return false
}

// 是否空队列
func (s *Queue) IsEmpty() bool {
    if s.head == s.tail {
        return true
    }
    return false
}

// 入队列
func (s *Queue) Push(item interface{}) bool {
    if s.IsFull() {
        return false
    }
    s.items[s.tail] = item
    s.tail = (s.tail+1) % s.size
    return true
}

// 出队列
func (s *Queue) Pop() interface{} {
    if s.IsEmpty() {
        return false
    }
    item := s.items[s.head]
    s.head = (s.head+1) % s.size
    return item
}

// 遍历
func (s *Queue) String() string {
    if s.IsEmpty() {
        return "empty queue"
    }
    result := "head"
    var i = s.head
    for true {
        result += fmt.Sprintf("<-%+v", s.items[i])
        i = (i + 1) % s.size
        if i == s.tail {
            break
        }
    }
    result += "<-tail"
    return result
}

func main() {
    s := NewQueue(10)
    fmt.Println("origin:")
    s.Push("1")
    s.Push("2")
    s.Push("3")
    fmt.Println(s)
    s.Pop()
    fmt.Println("now:")
    fmt.Println(s)
}
```

### 

### 参考链接

- 数据结构与算法之美(极客时间王争)