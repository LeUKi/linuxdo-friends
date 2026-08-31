# Chrome Web Store 提交说明

更新日期：2026-07-04

本说明用于把当前扩展准备成 Chrome Web Store 提交材料。当前执行范围只做披露一致性修复，不删除功能、不改迁移行为、不提交到 Chrome Web Store Dashboard。

官方参考：

- Chrome Web Store Program Policies: https://developer.chrome.com/docs/webstore/program-policies/policies/
- Limited Use: https://developer.chrome.com/docs/webstore/program-policies/limited-use/
- Manifest V3 requirements: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements/
- Extension permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions

## 产品定位

推荐定位：

> 佬朋友是面向 linux.do 的 local-first 朋友视图增强扩展，用于在用户自己的浏览器里管理已关注用户、刷新公开活动、查看佬有料，并按需启用云存档和 Telegram 通知。扩展界面打开时会检查 GitHub Release 更新，并使用 12 小时缓存。

必须保留的边界：

- 不绕过 Cloudflare。
- 不读取、导出或重放 Cookie。
- 不使用远程服务器代请求 linux.do。
- 不添加 `cookies`、`proxy`、`webRequest` 或 `declarativeNetRequest` 权限。
- 云存档只用于可迁移配置备份/恢复，不是 linux.do 代理。

## 权限说明

### `storage`

保存佬朋友列表、好友备注、打捞规则、请求统计、设置、通知凭据、云存档绑定状态、刷新状态和更新检查缓存。

### `tabs`

在用户触发的刷新、页面激活和 linux.do 页面协同场景中定位或打开浏览器标签页。用于当前浏览器会话内的页面读取和跳转，不用于跨站追踪。

### `sidePanel`

提供扩展主界面，让用户在 Chrome 侧栏中查看和管理佬朋友、佬有料、请求统计和设置。

### `alarms`

支持用户启用后的低频定时任务，例如每日自动云备份。后台闹钟是 best-effort，失败会降级记录状态，不做高频重试。

### `notifications`

在用户启用浏览器本地通知后，提醒自动或手动打捞发现的新内容。

## Host permissions 说明

### `https://linux.do/*`

用于 content script 页面增强，以及通过当前浏览器环境读取用户可见的 linux.do 公开页面/API。使用扩展不要求登录 linux.do，实际可获取的内容以 linux.do 对当前访问状态开放的数据为准。扩展不绕过 Cloudflare，不读取或导出 Cookie，不使用远程服务器代请求 linux.do。

### `https://api.telegram.org/*`

用于用户配置 Telegram Bot Token / Chat ID 后发送测试消息和启用后的通知消息。未配置或未触发通知时不调用。

### `https://api.github.com/*`

用于检查 GitHub Release 最新版本，提示用户是否有新版本可用。

### `https://github-api.lafish.workers.dev/*`

用于 GitHub Release 检查失败时的开发者控制镜像回退。该回退只请求 release 元数据，不上传佬朋友、打捞规则、Telegram 凭据或 linux.do 活动数据。

### `https://linuxdo-cloud-save.lafish.workers.dev/*`

用于云存档绑定、状态检查、备份和恢复。备份上传可迁移配置，包括佬朋友及其备注、打捞规则、请求统计、设置，以及已配置的 Telegram Bot Token / Chat ID。

## 数据使用声明建议

按当前实现，提交表单应覆盖以下类别和用途：

- 身份或账号标识：linux.do 用户名/ID 用于本地账号探测、云存档绑定显示和用户自己的数据归属。
- 用户活动或网站内容：用户可见的 linux.do 公开活动摘要、关注列表、帖子/回复/反应线索，以及用户自己填写的好友备注，用于好友视图和佬有料。
- 认证信息或敏感凭据：Telegram Bot Token / Chat ID、云存档绑定令牌。Telegram 凭据会随配置导出和云存档迁移。
- 扩展设置和诊断数据：刷新设置、通知设置、请求统计、更新检查状态，用于扩展功能和诊断。

推荐声明：

- 数据不出售。
- 数据不用于广告。
- 数据不用于与扩展单一用途无关的画像或信用判断。
- 数据仅为对应功能发送到对应服务：linux.do 请求服务于用户触发或低频刷新；Telegram API 和 `linuxdo-cloud-save.lafish.workers.dev` 只用于用户配置或启用的通知、云存档流程；GitHub API 和 `github-api.lafish.workers.dev` 用于扩展界面打开时的版本更新检查。
- 数据处理遵守 Chrome Web Store User Data Policy 和 Limited Use 要求。

## 隐私政策链接

提交前应把 `docs/privacy-policy.md` 发布到公开 HTTPS URL，并在 Chrome Web Store 表单中填写该 URL。仓库内草案不能代替最终可访问链接，除非仓库页面本身对审核者公开可访问。

## 商店文案草案

短描述：

> 本地优先管理 linux.do 佬朋友，刷新好友公开动态；可选云存档和 Telegram 通知，界面打开时检查更新。

详细描述：

> 佬朋友 - LinuxDo Friends 是面向 linux.do 的 local-first 浏览器扩展。它帮助你把已关注用户升级成更好用的佬朋友视图，在侧栏中查看好友最近状态、公开活动和佬有料，并在 linux.do 页面内显示入口。
>
> 数据优先保存在浏览器扩展本地存储中。你可以为已有佬朋友填写备注；备注默认保存在本地，配置导出和云存档启用后会随可迁移配置一起迁移。你也可以按需启用云存档，把可迁移配置备份到 linuxdo-cloud-save.lafish.workers.dev；也可以配置 Telegram Bot Token / Chat ID，在有新佬有料时发送 Telegram 通知。扩展还会检查 GitHub Release 以提示新版本。
>
> 扩展不绕过 Cloudflare，不读取或导出 Cookie，不使用远程服务器代请求 linux.do。云存档和 Telegram 属于可选集成；配置导出和云存档可能包含已配置的 Telegram Bot Token / Chat ID，请把备份文件作为私密数据保存。

## 商店素材

- Store icon: `store-assets/ld-friends-icon-128.png`
- Small promo tile: `store-assets/small-promo-tile-440x280.png`
- SVG sources: `store-assets/ld-friends-icon.svg`, `store-assets/small-promo-tile.svg`
- Extension manifest icons: `public/icons/icon-16.png`, `public/icons/icon-32.png`, `public/icons/icon-48.png`, `public/icons/icon-128.png`

## Source map 和发布包

当前 Vite 构建启用了 `sourcemap: true`，`scripts/package-extension.mjs` 会把 `dist-chrome/` 原样打包，因此 release zip 会包含 `.map` 文件。当前建议保留这一行为：项目开源，source map 有助于审核透明度和问题诊断；同时必须保证仓库源码和打包产物中没有硬编码个人密钥、Token 或 Cookie。

发布前检查：

```bash
npm run build
npm run package:chrome -- --name linuxdo-friends-v1.4.0-chrome.zip
zipinfo packages/linuxdo-friends-v1.4.0-chrome.zip | sort
```

如果之后决定从商店包排除 source map，应作为单独的 package-only 变更实现并验证，不要顺手改运行时逻辑。

## 提交前检查清单

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

额外人工检查：

- `manifests/common.json` 和 `manifests/chrome.json` 未新增 `cookies`、`proxy`、`webRequest`、`declarativeNetRequest` 或远程代码能力。
- 设置页披露 Telegram 凭据会随配置导出和云存档迁移。
- 云存档文案明确 `linuxdo-cloud-save.lafish.workers.dev` 和上传的可迁移配置边界。
- 隐私政策公开 URL 可访问，并与商店表单中的数据使用声明一致。
- 商店截图不要暗示扩展是 local-only，也不要暗示可以绕过 linux.do 风控。
