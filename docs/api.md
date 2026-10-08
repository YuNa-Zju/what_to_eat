# API 说明

同源前缀 `/api`。除照片上传外，写入请求使用 JSON。错误通常为 `{"error":"中文说明"}`；框架拒绝无效 JSON 或超大请求时也可能返回纯文本，客户端需提供通用提示。

无需认证，所有访问者均可修改共享内容。`wte_visitor` 是只用于投票的随机浏览器 Cookie，不代表账户或权限。浏览器跨站写入被拒绝，CLI 请求无需 Origin。

## 数据类型

- `Restaurant`：`id`、`name`、`active`。
- `Meal`：`id`、`restaurant_id`、`eaten_on`（`YYYY-MM-DD`）、`created_at`（UTC 毫秒）、`rating`（`1` 喜欢、`0` 一般、`-1` 不喜欢、`null` 未评价）。
- `Settings`：`window_size`，1–100 的整数。
- `Post`：`id`、`restaurant_id`、`eaten_on`、`nickname`、`body`（Markdown）、`shared_meal_id`、`created_at`、`likes`、`dislikes`、`my_vote`、`images`。
- `images`：`[{"id":"UUID","url":"/media/UUID"}]`。

饭店改名同步反映到旧记录展示，停用保留引用。窗口由客户端从完整历史计算，本地历史不调用共享历史接口。

## 路由

| 方法 | 路径 | 输入及行为 |
| --- | --- | --- |
| GET | `/health` | 数据库可查询时返回 `{"ok":true}` |
| GET | `/restaurants` | 全部饭店，包含停用项 |
| POST | `/restaurants` | `{name, active}`，名称 1–80 字，返回饭店 |
| PUT | `/restaurants/{id}` | `{name, active}`，返回 204 |
| GET / PUT | `/settings` | 读取或写入 `{window_size}` |
| GET | `/meals` | 全部共享历史，按用餐日期、录入时间倒序 |
| POST | `/meals` | `{id, restaurant_id, eaten_on, rating}`，返回记录；省略评价视为未评价 |
| PUT | `/meals/{id}` | 同上，修改饭店、日期和评价，返回 204 |
| DELETE | `/meals/{id}` | 删除共享历史，不删除帖子，返回 204 |
| GET | `/posts` | 倒序分页，每次最多 20 条 |
| POST | `/posts` | multipart 发布，返回完整帖子 |
| PUT | `/posts/{id}` | `{nickname, body}`，修改文字，照片保持原样，返回 204 |
| DELETE | `/posts/{id}` | 删除帖子、赞踩和图片引用，清理无引用照片，返回 204 |
| POST | `/posts/{id}/vote` | `{value:1}` 赞，`-1` 踩，`0` 取消，返回更新帖子 |
| GET | `/media/{uuid}` | 无 `/api` 前缀；返回仍被帖子引用的图片 |

饭店名称去掉首尾空格后按 SQLite NOCASE 比较，ASCII 大小写不敏感；停用重名店应恢复而非新增。下一页带末条记录的 `before=<created_at>&before_id=<id>`，同一毫秒按 UUID 字符串稳定排序。

## 发布帖子

multipart 包含一个 `payload` JSON 字段，以及零到六个 `photos` 二进制字段：

```json
{
  "id": "客户端生成的 UUID",
  "restaurant_id": "饭店 UUID",
  "eaten_on": "2026-10-08",
  "nickname": "",
  "body": "## 今天不错\n\n- 推荐牛肉",
  "record_meal": false,
  "meal_rating": null,
  "existing_meal_id": null
}
```

昵称最多 40 字，正文最多 10000 字；正文和照片至少有一项。每张照片最多 10 MiB、2500 万像素，按实际内容验证 JPEG、PNG、WebP。

`record_meal=true` 时，与发帖在同一事务中新增共享历史，`meal_rating` 作为这顿饭的评价。指定 `existing_meal_id` 则只关联该记录，其饭店和日期必须匹配，否则返回 409；不会覆盖原记录评价。选择本地记账时将 `record_meal` 设为 `false`，发布成功后以帖子 ID 幂等保存本地记录。

新建历史和帖子使用客户端 UUID 去重，重试保留同一 ID。重复历史 ID 内容不一致返回 409；重复帖子 ID 返回已存在帖子。后续编辑使用 PUT，不要改动 POST 内容后重用旧 ID。

图片在服务范围内去重。同一帖子重复上传同一文件只保留一份引用。服务器生成路径，不接受用户提供磁盘路径。

## 推荐概率

推荐在客户端计算，共享与本地历史分别统计。先排除停用饭店和最近窗口，再为剩余饭店计算权重：

```text
口味分 = (喜欢次数 - 不喜欢次数) / (已评价次数 + 3)
频率项 = 1 + 0.12 × 用餐次数 / (用餐次数 + 3)
权重 = clamp(exp(口味分) × 频率项, 0.5, 1.8)
推荐概率 = 权重 / 全部候选权重之和
```

未评价不计入口味分，新店权重为 1；窗口内饭店的当前概率为 0。帖子赞踩不计入用餐评价。用餐历史页展示当前概率和原始评价次数，便于理解调整。

## 并发和文件清理

单进程内，共享写入和媒体清理由同一异步锁协调，SQLite 事务保证共享发帖、记账及图片引用的原子性。

图片先写临时文件，重命名为 UUID 文件，再登记数据库。数据库失败时撤销新文件，崩溃残留由后台清理。删除帖子后清理失败不会恢复帖子，待清理状态保存在数据库供重试。
