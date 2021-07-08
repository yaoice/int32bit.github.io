---
layout: post
title: Ginkgo学习笔记
subtitle: ""
catalog: true
tags:
- Go

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

例如: 已经有一个books.go文件，内容如下
```
package books

type Book struct {
    Title  string
    Author string
    Pages  int
}

func (b *Book) CategoryByLength() string {

    if b.Pages >= 300 {
        return "NOVEL"
    }

    return "SHORT STORY"
}
```

#### 3.1 初始化Suite

编写Ginkgo测试用例，首先要bootstrap一个Ginkgo测试suite，如package名为book
```
~/go_workspace/src/books# ginkgo bootstrap
Generating ginkgo test suite bootstrap for books in:
        books_suite_test.go
```

```
~/go_workspace/src/test# cat book_suite_test.go 
package books_test

import (
        "testing"

        . "github.com/onsi/ginkgo"
        . "github.com/onsi/gomega"
)

func TestBooks(t *testing.T) {
        RegisterFailHandler(Fail)
        RunSpecs(t, "Books Suite")
}
```

使用`ginko`或`go test`运行suite
```
~/go_workspace/src/books# ginkgo 
Running Suite: Books Suite
==========================
Random Seed: 1610338671
Will run 0 of 0 specs


Ran 0 of 0 Specs in 0.000 seconds
SUCCESS! -- 0 Passed | 0 Failed | 0 Pending | 0 Skipped
PASS

Ginkgo ran 1 suite in 1.238236908s
Test Suite Passed
```

#### 3.2 为Suite添加Specs

空的测试套件不是很有趣。虽然您可以开始直接将测试添加到books_suite_test.go中，
更希望将测试分为单独的文件（尤其是对于包含多个文件的软件包）。让我们为book.go模型添加一个测试文件：
```
~/go_workspace/src/books# ginkgo generate books
Generating ginkgo test for Books in:
  books_test.go
```

```
~/go_workspace/src/books# cat books_test.go 
package books_test

import (
        . "github.com/onsi/ginkgo"
        . "github.com/onsi/gomega"

        "books"
)

var _ = Describe("Books", func() {

})
```
使用Ginkgo的Describe(text string，body func ()) bool函数添加了一个顶层描述容器。 
var _ = ...技巧使我们可以在最高级别评估Describe，方便作为被引入包时进行编译检查
而不必将其包装在func init() {}函数中

编辑`books_test.go`文件为Describe函数增加内容
```
package books_test

import (
    . "github.com/onsi/ginkgo"
    . "github.com/onsi/gomega"

    .  "books"
)

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
- 为了在`BeforeEach`和`It`之间共享状态，通常定义在`Describe`和`Context`的顶部
- 在CategoryByLength方法使用Gmega `Expect`语法来实现期望结果

ginko运行，查看是否跟预期结果一致
```
~/go_workspace/src/books# ginkgo 
Running Suite: Books Suite
==========================
Random Seed: 1610339269
Will run 2 of 2 specs

••
Ran 2 of 2 Specs in 0.000 seconds
SUCCESS! -- 2 Passed | 0 Failed | 0 Pending | 0 Skipped
PASS

Ginkgo ran 1 suite in 1.052407814s
Test Suite Passed
```

#### 3.4 标记Specs为Failed

Ginkgo提供`Fail`函数来标记specs为failed
```
Fail("Failure readson")
```
将为当前的space和panic记录为失败，停止当前的spec，没有后续代码被调用。
通常情况下，ginkgo将会recover这个panic，然后进行下一个测试

如果在`goroutine`中调用了Fail, 必须使用`GinkgoRecover`，否则直接导致Suite出现panic，且不会进行后续测试
```
It("panics in a goroutine", func(done Done) {
    go func() {
        defer GinkgoRecover()

        Ω(doSomething()).Should(BeTrue())

        close(done)
    }()
})
```
`doSomething`返回false，Gomega将会调用Fail, 引起panic，但现在会被GinkgoRecover捕获

#### 3.5 logging输出

1. Ginkgo提供了一个全局可用的`io.Writer`，叫做GinkgoWriter。
   GinkgoWriter在测试运行时聚合输入，并且只有在测试失败时才将其转储到stdout。
   `ginkgo -v`或`go test -ginkgo.v`形式运行，GinkgoWriter会立即将其输入重定向到stdout。

2. 当Ginkgo测试套件中断（通过^ C）时，Ginkgo将发出写入GinkgoWriter的任何内容。
   这样可以更轻松地调试卡住的测试。
3. 当与`--progress`配对使用时将会特别有用，它指示Ginkgo在运行您的BeforeEaches，Its，AfterEaches等时向GinkgoWriter发出通知。

### 4. Specs语法

Ginkgo可以使用`Describe`和`Context`容器来组织你的`It`规格，
使用`BeforeEach`和`AfterEach`来搭建和拆除测试中的常见设置。

#### 4.1 It

可以在`Describe`和`Context`部分放置`It`
```
var _ = Describe("Book", func() {
    It("can be loaded from JSON", func() {
        book := NewBookFromJSON(`{
            "title":"Les Miserables",
            "author":"Victor Hugo",
            "pages":1488
        }`)

        Expect(book.Title).To(Equal("Les Miserables"))
        Expect(book.Author).To(Equal("Victor Hugo"))
        Expect(book.Pages).To(Equal(1488))
    })
})
```
It也可以放在最上面，放在最上面的情况不常见

It处可以指定别名，使用Specify，PSpecify，XSpecify和FSpecify块；
```
Describe("The foobar service", func() {
  Context("when calling Foo()", func() {
    Context("when no ID is provided", func() {
      Specify("an ErrNoID error is returned", func() {
      })
    })
  })
})
```
Specify块的行为与It块相同，可以在It块（以及PIt，XIt和FIt块）的地方使用。

#### 4.2 BeforeEach & AfterEach

`BeforeEach`块可以在多个测试用例中使用公共的配置
```
var _ = Describe("Book", func() {
    var book Book

    BeforeEach(func() {
        book = NewBookFromJSON(`{
            "title":"Les Miserables",
            "author":"Victor Hugo",
            "pages":1488
        }`)
    })

    It("can be loaded from JSON", func() {
        Expect(book.Title).To(Equal("Les Miserables"))
        Expect(book.Author).To(Equal("Victor Hugo"))
        Expect(book.Pages).To(Equal(1488))
    })

    It("can extract the author's last name", func() {
        Expect(book.AuthorLastName()).To(Equal("Hugo"))
    })
})
```
1. BeforeEach在每个Specs之前运行，从而确保每个Specs都具有状态的原始副本.
   使用闭包变量共享公共状态（在本例中为var book Book）. 还可以在`AfterEach`块中执行清理操作。
2. 在`BeforeEach`和`AfterEach`块中设置断言也很常见
3. `AfterEach`在每个Specs之后运行，使用方式 和`BeforeEach`类似

#### 4.3 Describe & Context

使用Describe和Context容器在Suite中组织Specs：
```
var _ = Describe("Book", func() {
    var (
        book Book
        err error
    )

    BeforeEach(func() {
        book, err = NewBookFromJSON(`{
            "title":"Les Miserables",
            "author":"Victor Hugo",
            "pages":1488
        }`)
    })

    Describe("loading from JSON", func() {
        Context("when the JSON parses succesfully", func() {
            It("should populate the fields correctly", func() {
                Expect(book.Title).To(Equal("Les Miserables"))
                Expect(book.Author).To(Equal("Victor Hugo"))
                Expect(book.Pages).To(Equal(1488))
            })

            It("should not error", func() {
                Expect(err).NotTo(HaveOccurred())
            })
        })

        Context("when the JSON fails to parse", func() {
            BeforeEach(func() {
                book, err = NewBookFromJSON(`{
                    "title":"Les Miserables",
                    "author":"Victor Hugo",
                    "pages":1488oops
                }`)
            })

            It("should return the zero-value for the book", func() {
                Expect(book).To(BeZero())
            })

            It("should error", func() {
                Expect(err).To(HaveOccurred())
            })
        })
    })

    Describe("Extracting the author's last name", func() {
        It("should correctly identify and return the last name", func() {
            Expect(book.AuthorLastName()).To(Equal("Hugo"))
        })
    })
})
```
1. 使用`Describe`块来描述代码的各个行为
2. `Context`块在不同情况下执行这些行为。
3. 在这个例子中，我们`Describe`从JSON加载书籍并指定两个Contexts：
   当JSON成功解析时以及JSON无法解析时。除了语义差异，两种容器类型具有相同的行为。
4. 当嵌套`Describe`和`Context`块时，`It`执行时，围绕It的所有容器节点的`BeforeEach`块，
   从最外层到最内层运行。
5. 每个`It`块都运行`BeforeEach`和`AfterEach`块。这确保了每个规格的原始状态。
6. 始终在`BeforeEach`块中初始化变量
7. 在运行时获取有关当前测试的信息, 可以在任何`It`或`BeforeEach`/`JustBeforeEach/JustAfterEach`/`AfterEach`块中
   使用`CurrentGinkgoTestDescription()`, `CurrentGinkgoTestDescription`返回
   包含有关当前运行的测试的各种信息，包括文件名，行号，`It`块中的文本以及周围容器块中的文本

#### 4.4 JustBeforeEach

上面的例子中顶级`BeforeEach`使用有效的JSON创建了一个新的book, 
但是较低级别的`Context`使用无效的JSON创建的book执行，外层有一个`BeforeEach`，内层也有个`BeforeEach`,
重新创建并覆盖原始的book. `JustBeforeEach`块保证在所有`BeforeEach`块运行之后，并且在`It`块运行之前运行.
可以使用`JustBeforeEach`来处理这种情况.
```
var _ = Describe("Book", func() {
    var (
        book Book
        err error
        json string
    )

    BeforeEach(func() {
        json = `{
            "title":"Les Miserables",
            "author":"Victor Hugo",
            "pages":1488
        }`
    })

    JustBeforeEach(func() {
        book, err = NewBookFromJSON(json)
    })

    Describe("loading from JSON", func() {
        Context("when the JSON parses succesfully", func() {
            It("should populate the fields correctly", func() {
                Expect(book.Title).To(Equal("Les Miserables"))
                Expect(book.Author).To(Equal("Victor Hugo"))
                Expect(book.Pages).To(Equal(1488))
            })

            It("should not error", func() {
                Expect(err).NotTo(HaveOccurred())
            })
        })

        Context("when the JSON fails to parse", func() {
            BeforeEach(func() {
                json = `{
                    "title":"Les Miserables",
                    "author":"Victor Hugo",
                    "pages":1488oops
                }`
            })

            It("should return the zero-value for the book", func() {
                Expect(book).To(BeZero())
            })

            It("should error", func() {
                Expect(err).To(HaveOccurred())
            })
        })
    })

    Describe("Extracting the author's last name", func() {
        It("should correctly identify and return the last name", func() {
            Expect(book.AuthorLastName()).To(Equal("Hugo"))
        })
    })
})
```
这个例子中，对每一个`It`，book实际上只创建一次。
这个失败的JSON上下文可以简单地将无效的json值分配给`BeforeEach`中的json变量。

1. `JustBeforeEach`允许将创建与配置分离
2. 使用`BeforeEach`指定和修改配置
3. 使用`JustBeforeEach`创建配置
4. 不建议使用嵌套的的`JustBeforeEach`，语法是合法的。
   Ginkgo将首先从外到内运行所有的`BeforeEach`，然后它将从外到内运行所有的`JustBeforeEach`
   
#### 4.5 JustAfterEach

运行在在销毁（可能会破坏有用的状态）之前，在每一个`It`块之后。 比如，测试失败后，
执行一些诊断的操作。我们可以在上面的示例中使用它来检查测试是否失败，如果失败，则打印实际的book：
```
JustAfterEach(func() {
        if CurrentGinkgoTestDescription().Failed {
            fmt.Printf("Collecting diags just after failed test in %s\n", CurrentGinkgoTestDescription().TestText)
            fmt.Printf("Actual book was %v\n", book)
        }
    })
```
1. `JustAfterEach`块保证在所有`AfterEach`块运行之前，并且在`It`块运行之后运行.
2. 也是不建议使用嵌套的的`JustAfterEach`，语法是合法的。
Ginkgo将首先从内到外运行所有的`JustAfterEach`，然后它将从内到外运行所有的`AfterEach`

#### 4.6 BeforeSuite & AfterSuite

Ginkgo提供了`BeforeSuite`和`AfterSuite`来实现
在整个测试之前运行一些设置代码和在整个测试之后运行一些清理代码,如：启动或销毁外部数据库

```
package books_test

import (
    . "github.com/onsi/ginkgo"
    . "github.com/onsi/gomega"

    "your/db"

    "testing"
)

var dbRunner *db.Runner
var dbClient *db.Client

func TestBooks(t *testing.T) {
    RegisterFailHandler(Fail)

    RunSpecs(t, "Books Suite")
}

var _ = BeforeSuite(func() {
    dbRunner = db.NewRunner()
    err := dbRunner.Start()
    Expect(err).NotTo(HaveOccurred())

    dbClient = db.NewClient()
    err = dbClient.Connect(dbRunner.Address())
    Expect(err).NotTo(HaveOccurred())
})

var _ = AfterSuite(func() {
    dbClient.Cleanup()
    dbRunner.Stop()
})
```
1. `BeforeSuite`函数在任何Specs运行之前运行。
   如果`BeforeSuite`运行失败则没有Specs将会运行，测试Suite运行结束。
2. `AfterSuite`函数在所有的Specs运行之后运行，无论是否有任何测试的失败。由于`AfterSuite`通常有一些代码来清理持久的状态，
   所以当你使用`control+c`打断运行的测试时，Ginkgo也将会运行`AfterSuite`。要退出`AfterSuite`的运行，再次输入`control+c`。
3. 传递带有`Done`参数的函数，可以异步运行`BeforeSuite`和`AfterSuite`
4. 只能在测试套件中定义一次`BeforeSuite`和`AfterSuite`
5. 并行运行时，每个并行进程都将运行`BeforeSuite`和`AfterSuite`函数

#### 4.7 By文档化It

在集成式测试中测试复杂的工作流时。在这些情况下，查看代码难以看出具体问题所在，这些情况下，Ginkgo通过`By`来提供帮助
```
var _ = Describe("Browsing the library", func() {
    BeforeEach(func() {
        By("Fetching a token and logging in")

        authToken, err := authClient.GetToken("gopher", "literati")
        Exepect(err).NotTo(HaveOccurred())

        err := libraryClient.Login(authToken)
        Exepect(err).NotTo(HaveOccurred())
    })

    It("should be a pleasant experience", func() {
        By("Entering an aisle")

        aisle, err := libraryClient.EnterAisle()
        Expect(err).NotTo(HaveOccurred())

        By("Browsing for books")

        books, err := aisle.GetBooks()
        Expect(err).NotTo(HaveOccurred())
        Expect(books).To(HaveLen(7))

        By("Finding a particular book")

        book, err := books.FindByTitle("Les Miserables")
        Expect(err).NotTo(HaveOccurred())
        Expect(book.Title).To(Equal("Les Miserables"))

        By("Check the book out")

        err := libraryClient.CheckOut(book)
        Expect(err).NotTo(HaveOccurred())
        books, err := aisle.GetBooks()
        Expect(books).To(HaveLen(6))
        Expect(books).NotTo(ContainElement(book))
    })
})
```
1. 传递给By的字符串是通过`GinkgoWriter`发出的。如果测试成功，将看不到文本之外的任何输出。
   但是，如果测试失败，将看到失败之前的每个步骤的打印输出。使用`ginkgo -v`总是输出所有步骤打印。
2. `By`采用一个可选的`fun()`类型函数。当传入这样的一个函数时，`By`将会立刻调用该函数。这将允许您组织您的多个It到一组步骤，但这纯粹是可选的。
   在实际应用中，每个`By`函数是一个单独的回调，这一特性限制了这种方法的可用性

### 参考链接

- [http://onsi.github.io/ginkgo](http://onsi.github.io/ginkgo/)
- [https://www.ginkgo.wiki/gou-jian-ni-de-spec.html](https://www.ginkgo.wiki/gou-jian-ni-de-spec.html)
