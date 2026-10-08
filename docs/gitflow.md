# 分支和提交约定

- `master`：发布版本，也是仓库初始分支。
- `develop`：下一版本的集成分支。
- `feature/<简短英文名>`：从 `develop` 创建，完成后合回 `develop`。
- `release/<版本>`：从 `develop` 创建，整理版本与说明后合入 `master`、打标签，再同步回 `develop`。
- `hotfix/<简短英文名>`：从 `master` 创建，修复后合入 `master` 和 `develop`，打补丁版本标签。

合并使用 `--no-ff` 保留分支结构，不强制改写已推送的共享分支。

```text
master → develop → feature/initial-app → develop
                                        ↓
                                  release/0.1.0
                                    ↙       ↘
                          master + v0.1.0   develop
```

标题使用简短中文，一次提交聚焦一个功能领域。具体改动及验证写在正文，不强制 Conventional Commits 前缀。

```text
添加用餐分享

支持 Markdown 正文、匿名昵称、照片附件与赞踩。
新增手机格式工具栏和桌面并排预览。

前端构建和基础测试通过，已检查手机尺寸的编辑与预览。
```

版本标签对应源码和验证记录，远程部署独立进行。发布说明应准确写明实际检查与尚未覆盖的场景，不把本地预览等同于生产上线。
