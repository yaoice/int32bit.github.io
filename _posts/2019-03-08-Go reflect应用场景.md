---
layout: post
title: Go reflect应用
subtitle: ""
catalog: true
tags:
     - Go
---


### 简介

推荐先阅读下来自Go官方Blog的[laws-of-reflection](https://blog.golang.org/laws-of-reflection)，Go语言创始人之一Rob Pike写的.

Reflection: 反射是程序检查自身结构，类型的一种能力，它是元编程的一种形式。


#### types和interfaces

Go中的types，因为reflect是基于types构建，Go是静态类型，每个变量在编译时都有固定的类型，举个例来看：

```
type TestInt int
var i int
var j TestInt
```
变量i，j的静态类型是不同的，尽管它们的基础类型是一样的，如果没有转换的话，它们之间不能互相赋值。

Go中的interface，interface类型是一种重要的类型，interface变量可以存放任何具体变量(非interface)，只要实现这个接口的所有方法。
举例来看：

io库中的io.Reader和io.Writer

```
// Implementations must not retain p.
type Reader interface {
	Read(p []byte) (n int, err error)
}

// Implementations must not retain p.
type Writer interface {
	Write(p []byte) (n int, err error)
}
```

io.Reader/io.Writer类型的变量可以接受任何类型具有read/write方法的值，举例来看：

```
var r io.Reader
r = os.Stdin
r = bufio.NewReader(r)
r = new(bytes.Buffer)
```
r的类型总是io.Reader

interface类型中有个非常重要的典型：空interface
```
interface{}
```

Go中的interface不是动态类型，它们是静态类型，interface类型的变量始终是相同的静态类型，尽管interface变量中的值在运行时可能会改变类型。
interface总是(value,具体类型)的形式，而不是(value,interface类型)的形式


### Reflection法则

reflect库，有两个类型：Type、Value，还有两个简单的函数：reflect.TypeOf、reflect.ValueOf

#### 反射从接口值到反射对象  

```
package main

import (
	"fmt"
	"reflect"
)

func main() {
	var x float64 = 3.4
	fmt.Println("type:", reflect.TypeOf(x))
}

# 运行结果
type: float64
```

查看TypeOf的定义，输入参数是个空interface类型
```
// TypeOf returns the reflection Type that represents the dynamic type of i.
// If i is a nil interface value, TypeOf returns nil.
func TypeOf(i interface{}) Type {
	eface := *(*emptyInterface)(unsafe.Pointer(&i))
	return toType(eface.typ)
}
```
当调用reflect.TypeOf(x)时，x第一次存储在空interface，然后作为参数传入，reflect.TypeOf解包空interface,
并还原其类型信息. reflect.ValueOf则是还原其value信息.

```
var x float64 = 3.4
	fmt.Println("value:", reflect.ValueOf(x).String())

运行结果：
value: <float64 Value>
```
fmt包默认情况下会使用reflect.Value来显示变量的具体值，用String方法则不会进行此操作.

此外还有Kind方法来分类存储的类型：有Uint，Float64，Slice等等

```
var x float64 = 3.4
	v := reflect.ValueOf(x)
	fmt.Println("type:", v.Type())
	fmt.Println("kind is float64:", v.Kind() == reflect.Float64)
	fmt.Println("value:", v.Float())
	
运行结果：
type: float64
kind is float64: true
value: 3.4
```  

```
type MyInt int
var x MyInt = 7
v := reflect.ValueOf(x)
fmt.Println("type:", v.Type())                        // MyInt.
fmt.Println("kind is int: ", v.Kind() == reflect.Int) // true.
```
Kind判断依旧是reflect.Int，Kind不能识别是来自MyInt的int，尽管静态类型是MyInt


#### 反射从反射对象到接口值  

Go反射反转

Interface方法，把type和value信息又重新打包回interface

```
// Interface returns v's current value as an interface{}.
// It is equivalent to:
//	var i interface{} = (v's underlying value)
// It panics if the Value was obtained by accessing
// unexported struct fields.
func (v Value) Interface() (i interface{}) {
	return valueInterface(v, true)
}
```

```
var x float64 = 3.14
	v := reflect.ValueOf(x)
	fmt.Println(v.Interface())
	fmt.Printf("%7.1e\n", v.Interface())
	
运行结果：
3.14
3.1e+00
```


#### 修改反射对象，值必须是可设置

```
var x float64 = 3.4
	p := reflect.ValueOf(&x) // Note: take the address of x.
	fmt.Println("type of p:", p.Type())
	fmt.Println("settability of p:", p.Elem().CanSet())

运行结果：
type of p: *float64
settability of p: true
```

要想修改反射对象的值，得把x的地址作为参数传进去，p.Elem()得到p指针真正指向的地方

```
var x float64 = 3.4
	p := reflect.ValueOf(&x) // Note: take the address of x.
	fmt.Println("type of p:", p.Type())
	v := p.Elem()                     x
	fmt.Println("settability of p:", v.CanSet())
	v.SetFloat(7.1)
	fmt.Println(v.Interface())
	fmt.Println(x)

运行结果：
type of p: *float64
settability of p: true
7.1
7.1
```

修改Struct的值

```
type T struct {
    A int
    B string
}
t := T{23, "skidoo"}
s := reflect.ValueOf(&t).Elem()
typeOfT := s.Type()
for i := 0; i < s.NumField(); i++ {
    f := s.Field(i)
    fmt.Printf("%d: %s %s = %v\n", i,
        typeOfT.Field(i).Name, f.Type(), f.Interface())
}

运行结果：
0: A int = 23
1: B string = skidoo
```

```
type T struct {
	A int
	B string
}
t := T{23, "skidoo"}
s := reflect.ValueOf(&t).Elem()
typeOfT := s.Type()
for i := 0; i < s.NumField(); i++ {
	f := s.Field(i)
	s.Field(0).SetInt(77)
	s.Field(1).SetString("Sunset Strip")
	fmt.Printf("%d: %s %s = %v\n", i,
	    typeOfT.Field(i).Name, f.Type(), f.Interface())
}
fmt.Println("t is now", t)

运行结果：
0: A int = 77
1: B string = Sunset Strip
t is now {77 Sunset Strip}
```

### reflect应用场景

#### 动态无参调用函数

```
type T struct{}

func main() {
	name := "Do"
	t := &T{}
	reflect.ValueOf(t).MethodByName(name).Call(nil)
}

func (t *T) Do() {
		fmt.Println("hello world")
}

运行结果：
hello world
```

#### 动态有参调用函数

```
type T struct{}

func main() {
	name := "Do"
	t := &T{}
	a := reflect.ValueOf("hello")
	b := reflect.ValueOf("world")
	in := []reflect.Value{a, b}
	reflect.ValueOf(t).MethodByName(name).Call(in)
}

func (t *T) Do(v ...string) {
	for _, i := range v {
		fmt.Println("hello " + i)
	}
}

运行结果：
hello hello
hello world
```

#### struct tag解析

```
type T struct {
	A string    `json:"a" test:"ta"`
	B string `json:"b" test:"tb"`
}

func main() {
	t := T{
		A: "a",
		B: "b ",
	}
	tt := reflect.TypeOf(t)
	for i := 0; i < tt.NumField(); i++ {
		field := tt.Field(i)
		if json, ok := field.Tag.Lookup("json"); ok {
			fmt.Println(json)
		}
		test := field.Tag.Get("test")
		fmt.Println(test)
	}
}

运行结果：
a
ta
b
tb
```


####  struct类型转换、赋值

```
type T struct {
	A int    `newT:"AA"`
	B string `newT:"BB"`
}

type newT struct {
	AA int
	BB string
}

func main() {
	t := T{
		A: 123,
		B: "hello",
	}
	tt := reflect.TypeOf(t)
	tv := reflect.ValueOf(t)

	newT := &newT{}
	newTValue := reflect.ValueOf(newT)

	for i := 0; i < tt.NumField(); i++ {
		field := tt.Field(i)
		newTTag := field.Tag.Get("newT")
		tValue := tv.Field(i)
		newTValue.Elem().FieldByName(newTTag).Set(tValue)
	}

	fmt.Println(newT)
}

运行结果：
&{123 hello}
```


#### 判断实例实现某接口

```
type TestInterfafce interface {
	test()
}

type T struct {
	A string
}

func (t *T) test() {}

func main() {
	t := &T{}
	TIF := reflect.TypeOf((*TestInterfafce)(nil)).Elem()
	tv := reflect.TypeOf(t)
	fmt.Println(tv.Implements(TIF))
}

运行结果：
true
```
	
### 参考链接

- [laws-of-reflection](https://blog.golang.org/laws-of-reflection)
- [Go Reflect 高级实践](https://segmentfault.com/a/1190000016230264)