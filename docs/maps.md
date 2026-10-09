# 高德地图配置

在高德控制台为本应用创建 **Web 端（JS API）** Key，同时取得安全密钥 securityJsCode。按实际访问域名设置白名单，包含生产域名及需要的本地预览域名。

- [官方申请步骤](https://lbs.amap.com/api/javascript-api-v2/prerequisites)
- [官方服务端代理建议](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)

复制仓库根目录 `.env.example` 为 `.env`，填写 `AMAP_JS_KEY` 和 `AMAP_SECURITY_JS_CODE`。Rust 启动时读取当前工作目录的 `.env`，已有进程环境变量优先；生产也可用 systemd 的 `EnvironmentFile` 注入。这两个变量同时存在时地图才启用，修改后需重启 Rust。`.env` 已被 Git 忽略，不要将密钥填写到 Vite 变量、源代码或部署脚本中。

浏览器按需获取公开 JS Key 并加载 SDK；安全密钥只由 Rust 的 `/_AMapService` 同源代理添加。不要自行给前端配置 `securityJsCode`。公开 JS Key 必然会出现在 SDK 加载地址中，可用域名白名单限制使用；安全密钥不会进入前端配置或构建产物。

Vite 已代理该路径。生产 Nginx 应把 `/_AMapService/` 与 `/api/`、`/media/` 一样转发给 Rust；若全部请求均已转发 Rust，则无需新增规则。服务自带地图域名的 CSP，外部反向代理如另设 CSP，需同步允许 `webapi.amap.com`、`*.amap.com`、`*.autonavi.com` 相关脚本、图片与连接以及 blob worker。高德 JS 2.0 的渲染器需要运行时生成代码，因此仅在地图配置启用时允许 `script-src` 的 `unsafe-eval`；内联脚本仍禁止，未启用地图时不开放外部地图来源及此能力。保持 `X-Content-Type-Options: nosniff`，代理会为校验后的 JSONP 响应设置正确类型。

地图初次展开才加载。搜索城市或地点后点击结果即可跳转，编辑资料时同时填入位置与地址；也可点击地图或拖动标记调整。只有点击定位按钮才请求浏览器定位权限，普通浏览不会请求。无配置、网络失败时可以继续编辑文字和照片，已有坐标不会自动清除。

SQLite 迁移 `0007` 为饭店增加地址、坐标 JSON 与封面引用，并扩展上传凭据的饭店绑定。启动自动迁移，旧资料默认为空。更新前备份整个 `DATA_DIR`（数据库和照片），回退程序前需恢复对应旧备份；旧版程序虽仍可使用原接口，但不能管理新封面引用。
