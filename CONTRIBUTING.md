# 维护流程

1. 从main建立feature或fix分支，并关联一个明确Issue。
2. 只用合成数据测试。不要提交真实表格、PDF、备份、导出结果或本机路径。
3. 修改统计逻辑时同时更新`docs/STATISTICS.md`、页面说明、导出口径及测试。
4. 运行`pnpm format:check`、`pnpm test`、`pnpm build`。
5. 提交PR，记录用户可见行为、兼容性、验证方式与未解决事项。
6. 合入main后等待Pages部署成功，再打版本标签和创建Release。

仓库保留源代码和合成测试。旧本地项目历史留在原本机仓库，公开仓库从清理后的版本独立起步。
