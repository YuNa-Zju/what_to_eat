# 部署说明

首版已在本机运行预览。以下步骤用于后续服务器部署，不代表已经在远程生产环境上线。

## 构建产物

在与目标服务器兼容的系统和架构上构建。macOS 生成的程序不能直接在 Linux 上运行；最简单的方式是在目标 Linux 服务器或匹配的 Linux 构建环境构建。

需要 Rust 稳定工具链、C 编译工具链、Node.js 22.12+（或兼容更新 LTS）和 npm。SQLx 使用捆绑 SQLite，无需配置外部数据库服务。

```sh
git clone git@github.com:YuNa-Zju/what_to_eat.git
cd what_to_eat
git switch master
cd frontend
npm ci
npm run typecheck
npm run build
cd ..
cargo test --locked
cargo build --release --locked
```

部署文件：

```text
/srv/what-to-eat/
  what-to-eat        # target/release/what-to-eat
  public/           # frontend/dist 的完整内容
  data/             # 服务可写，升级时保留
    app.sqlite
    uploads/
    tmp/
```

迁移和初始饭店资源编译到程序中，无需单独复制。

## 配置与启动

配置通过环境变量提供，程序不会自动加载 `.env` 文件。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `BIND_ADDR` | `127.0.0.1:3000` | HTTP 监听地址 |
| `STATIC_DIR` | `frontend/dist` | 网页产物目录，必须有 `index.html` |
| `DATA_DIR` | `data` | 数据库、上传和临时文件目录 |
| `COOKIE_SECURE` | `false` | HTTPS 部署设为 `true`；HTTP 开发保持 `false` |
| `RUST_LOG` | `what_to_eat=info,tower_http=info` | 日志过滤 |

相对路径相对于工作目录，生产环境建议使用绝对路径。

```sh
STATIC_DIR=/srv/what-to-eat/public \
DATA_DIR=/srv/what-to-eat/data \
BIND_ADDR=127.0.0.1:3000 \
COOKIE_SECURE=true \
/srv/what-to-eat/what-to-eat
```

首次启动创建目录、迁移数据库并加入 30 家饭店，后续启动不会重置名单。数据库使用 WAL 和外键。

只运行一个服务实例，不要让多个进程共用数据目录。文件引用和删除通过进程内锁与 SQLite 事务协调，多实例不在本版支持范围内。

## systemd 与 HTTPS

附有 [systemd 示例](../deploy/what-to-eat.service) 和 [Nginx 示例](../deploy/nginx.conf)。使用前需要创建专用的 `what-to-eat` 系统用户，创建并授权 `data` 目录可写；程序和网页只需可读。

将服务文件放入 `/etc/systemd/system/`，校对路径和用户名。将 Nginx 的 `food.example.com` 和证书路径替换成真实值，配置有效 HTTPS 证书。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now what-to-eat
sudo nginx -t
sudo systemctl reload nginx
```

Nginx 必须保留浏览器原始 `Host`，与 `Origin` 一致才能通过同源写入检查。代理上传限制为 64 MiB，应用总请求限制为 62 MiB，照片仍逐张限制 10 MiB，最多 6 张。

远程访问使用 HTTPS：浏览器 UUID API 需要安全上下文，`COOKIE_SECURE=true` 时投票 Cookie 只经 HTTPS 发送。`localhost` 开发可以使用 HTTP。

启动后检查 `/api/health` 返回 `{"ok":true}`，并实际打开主页；健康接口成功不代表静态页面已通过验收。

## 数据与照片

数据库存储照片 UUID、MD5、大小、媒体类型、相对路径和帖子引用。原始文件名不参与服务器路径。

MD5 和大小相同后仍比较完整内容，完全一致才复用。帖子删除后，无引用图片立即清理；文件删除失败保留待清理状态，每 5 分钟及启动时重试。崩溃留下的未登记文件在超过 1 小时后清理。

选图后浏览器立即压缩并提前上传，最多同时处理两张：校正方向、限制最长边 1280 像素、WebP 质量 0.6，目标体积 300 KiB；超过目标继续缩小，最低最长边 320 像素，保留透明通道。保存时只传文字和上传编号，尚未完成的上传会先等待，失败可单张重试。

服务器仍解码验证格式和像素上限。已符合尺寸及体积要求的 WebP 直接复用，其他新上传图片使用有损 WebP 质量 60 编码；不支持浏览器 WebP 编码的环境可上传缩小后的 PNG，由服务器转换。已有已发布图片保持原样，升级不会批量改写用户照片。摘要和完整字节核对针对最终文件执行，不进行视觉相似度去重。

迁移 `0006_photo_uploads` 新增临时上传凭据，按访客 Cookie 隔离，24 小时有效。表单关闭或照片移除时尝试丢弃上传，残留凭据到期后在每 5 分钟及启动时清理。仅被未到期草稿引用的图片不会误删，也不会通过 `/media` 公开提供；已发布图片按帖子引用保留。

## 备份恢复与更新

数据库和照片需要配套备份。小团体可以短暂停止服务再备份完整 `data`；不要只复制运行中的 `app.sqlite` 而漏掉 WAL。

```sh
sudo systemctl stop what-to-eat
sudo tar -C /srv/what-to-eat -czf /srv/what-to-eat-backup.tar.gz data
sudo systemctl start what-to-eat
```

实际备份使用带日期且不会覆盖旧备份的文件名。恢复时停止服务，保留当前目录副本，将整份备份恢复到 `DATA_DIR`，恢复所属用户和权限后启动。不要混用不同时间的数据库和照片。

升级前备份数据，在停止服务后一起替换程序和网页，保留 `data`，再启动验收。发生迁移后，回滚需要恢复迁移前的数据库和照片备份，本版不提供自动降级迁移。

正式使用前执行 [验证清单](verification.md)，尤其是手机软键盘、照片上传及最后一个图片引用删除。
