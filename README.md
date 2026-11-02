# DNV 船检文控工作台

将文控台账、DNV Documents 和 Comments 导出表关联，查询图纸送审、返回及意见往来，并导出统计和保留原格式的台账。

## 在线使用

[打开工作台](https://leosadfsd.github.io/dnv-document-control/) · [版本发布](https://github.com/Leosadfsd/dnv-document-control/releases) · [任务清单](https://github.com/Leosadfsd/dnv-document-control/issues)

1. 在“资料导入”设置项目名称、本地项目标识和DNV项目号。
2. 依次导入文控台账、Documents及全状态/全版本Comments，检查预览并确认来源范围。
3. 在“船检统计”查看送审/返回/闭环数字，点击数字展开明细，按负责人、图号、批复代码等筛选。
4. “导出统计包”下载CSV/TXT；页首“导出台账”保留原Excel格式并追加明确的DNV字段。
5. “Letter处理”读取文本PDF批复表，为每个图号复制整封原PDF并生成文件名。

工具是纯静态网页，选择的Excel/PDF由浏览器本地读取，不发送至GitHub或其他服务器。结构化资料存于当前浏览器的IndexedDB；PDF仅临时处理。不同浏览器、设备及网址的数据不共享，换环境请使用“数据管理”的备份/恢复。程序本身的访问仍由GitHub Pages提供，站点没有登录或云端同步功能。

## 统计口径

- 应送范围来自台账明确DNV勾选，人工排除清单只影响统计，不删除数据。
- 最新送审对应结果与历史返回分开，不能用旧版批复替代新版待返回。
- 父意见按项目号+Comment ID去重，回复不增加意见数；Open/Closed/其他状态分开。
- FI/DI无Open时单列不适用；未知状态、来源不完整等进入待确认，不自动推断闭环。
- 当前责任方不等于工程师从未回复；活动时间不作为正式回复时间。

完整定义见[统计口径](docs/STATISTICS.md)。

## 开发

需要Node.js 22.12或以上及pnpm 10.11.0。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm dev
```

`pnpm serve:local`在127.0.0.1:4187启动本机成品。Windows可双击`Open-Local.cmd`。在线版无需启动本机服务。

## 维护

- [项目计划与验收标准](docs/PROJECT.md)
- [贡献及发布流程](CONTRIBUTING.md)
- [版本记录](CHANGELOG.md)
- [安全及数据边界](SECURITY.md)

当前版本0.3.1，32项合成测试。桌面Chrome和390px窄屏经过检查；真实手机、Win7、离线更新及多项目切换仍待验证。仓库不附带业务数据、历史内部交接记录或任何用户文件。
