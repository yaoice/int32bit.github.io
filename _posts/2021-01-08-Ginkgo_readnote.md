---
layout: post
title: Ginkgo学习笔记
subtitle: ""
catalog: true
hide: true
tags:
- k8s

---

## Ginkgo

### 1. Ginkgo简介

>Ginkgo是一个BDD风格的Go测试框架，旨在帮助你有效地编写富有表现力的全方位测试。它最好与Gomega匹配器库配对使用，但它的设计是与匹配器无关的。

TDD vs BDD vs ATDD区别？
- TDD：Test-Driven Development(TDD)即测试驱动开发，它是一种测试先于编写代码的思想用于指导软件开发。
  测试驱动开发是敏捷开发中的一项核心实践和技术，也是一种设计方法论。TDD的原理是在开发功能代码之前，先编写单元测试用例代码，测试代码确定需要编写什么产品代码。
  
- BDD：行为驱动开发（Behavior Driven Development）是一种敏捷软件开发的技术，它鼓励软件项目中的开发者、QA和非技术人员或商业参与者之间的协作
  
- ATDD：验收测试驱动开发（Acceptance Test Driven Development）TDD只是开发人员的职责，通过单元测试用例来驱动功能代码的实现。
  在准备实施一个功能或特性之前，首先团队需要定义出期望的质量标准和验收细则，以明确而且达成共识的验收测试计划（包含一系列测试场景）
  来驱动开发人员的TDD实践和测试人员的测试脚本开发。面向开发人员，强调如何实现系统以及如何检验。

### 2. Ginkgo安装

```
# go get github.com/onsi/ginkgo/ginkgo
# go get github.com/onsi/gomega/...
```
安装ginkgo库和安装ginkgo可执行文件到$GOPATH/bin目录下

### 3. 开始：编写第一个测试用例

Ginkgo在Go的现有测试基础架构上做了hook，这使您可以使用go test运行Ginkgo套件。
这也意味着Ginkgo测试可以与传统的Go测试同时使用。 go test和ginkgo都将运行suite中的所有测试。

#### 3.1 初始化Suite

编写Ginkgo测试用例，首先要bootstrap一个Ginkgo测试suite，如package名为main
```
cd $GOPATH/src/test
~/go_workspace/src/test# ginkgo bootstrap
Generating ginkgo test suite bootstrap for main in:
        test_suite_test.go
```

```
~/go_workspace/src/test# cat test_suite_test.go 
package main_test

import (
        "testing"

        . "github.com/onsi/ginkgo"
        . "github.com/onsi/gomega"
)

func TestTest(t *testing.T) {
        RegisterFailHandler(Fail)
        RunSpecs(t, "Test Suite")
}
```

使用`ginko`或`go test`运行suite
```
~/go_workspace/src/test# ginkgo 
Running Suite: Test Suite
=========================
Random Seed: 1610087694
Will run 0 of 0 specs


Ran 0 of 0 Specs in 0.000 seconds
SUCCESS! -- 0 Passed | 0 Failed | 0 Pending | 0 Skipped
PASS

Ginkgo ran 1 suite in 1.028346458s
Test Suite Passed
```

#### 3.2 为Suite添加Specs

空的测试套件不是很有趣。虽然您可以开始直接将测试添加到books_suite_test.go中，
更希望将测试分为单独的文件（尤其是对于包含多个文件的软件包）。让我们为book.go模型添加一个测试文件：
```
~/go_workspace/src/test# ginkgo generate book
Generating ginkgo test for Book in:
  book_test.go
```

```
~/go_workspace/src/test# cat book_test.go 
package main_test

import (
        . "github.com/onsi/ginkgo"
        . "github.com/onsi/gomega"

        "test"
)

var _ = Describe("Book", func() {

})
```
使用Ginkgo的Describe(text string，body func ()) bool函数添加了一个顶层描述容器。 
var _ = ...技巧使我们可以在最高级别评估Describe，方便作为被引入包时进行编译检查
而不必将其包装在func init() {}函数中

为Describe函数增加内容
```
var _ = Describe("Book", func() {
    var (
        longBook  Book
        shortBook Book
    )

    BeforeEach(func() {
        longBook = Book{
            Title:  "Les Miserables",
            Author: "Victor Hugo",
            Pages:  1488,
        }

        shortBook = Book{
            Title:  "Fox In Socks",
            Author: "Dr. Seuss",
            Pages:  24,
        }
    })

    Describe("Categorizing book length", func() {
        Context("With more than 300 pages", func() {
            It("should be a novel", func() {
                Expect(longBook.CategoryByLength()).To(Equal("NOVEL"))
            })
        })

        Context("With fewer than 300 pages", func() {
            It("should be a short story", func() {
                Expect(shortBook.CategoryByLength()).To(Equal("SHORT STORY"))
            })
        })
    })
})
```
- Ginkgo充分利用了闭包，从而允许您构建描述性的测试套件。
- 应该充分利用`Describe`和`Context`来组织代码行为
- 可以使用`BeforeEach`在specs中建立状态。使用`It`来指定一种单一状态
- 为了在`BeforeEach`和`It`
