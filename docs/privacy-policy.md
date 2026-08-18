# 佬朋友隐私政策草案

更新日期：2026-07-04

本政策适用于 Chrome 扩展「佬朋友 - LinuxDo Friends」。佬朋友是 local-first 扩展：默认数据优先保存在浏览器扩展本地存储中，但用户可以启用云存档和 Telegram 通知等可选集成。扩展界面打开时会检查 GitHub Release 更新，并使用 12 小时缓存。

## 数据类别

扩展可能在本地保存以下数据：

- linux.do 当前账号探测结果，例如用户名、用户 ID 和探测时间。
- 佬朋友列表、已关注候选、好友备注、活动摘要、头像缓存和公开动态缓存。
- 佬有料打捞规则、命中的公开动态条目、刷新进度和请求统计。
- 扩展设置，包括刷新间隔、通知开关、云存档开关、Telegram Bot Token 和 Telegram Chat ID。
- 云存档绑定凭据和最近备份/恢复状态。
- GitHub Release 更新检查状态。

导出的配置和云存档备份属于可迁移配置，包含佬朋友及其备注、打捞规则、请求统计、设置，以及已配置的 Telegram Bot Token / Chat ID。好友备注是 local-first 数据：默认保存在本地；用户导出配置或启用云存档后，会随可迁移配置一起迁移。账号登录状态、动态内容缓存和头像缓存不会随配置导出。

## 外部服务

### linux.do

扩展会在用户已登录 linux.do 的浏览器环境中读取用户可见的页面和公开接口，用于同步关注列表、刷新好友公开活动、识别当前账号和增强页面展示。扩展不绕过 Cloudflare，不读取或导出 Cookie，不重放 Cookie，不使用远程服务器代请求 linux.do。

### Telegram API

用户配置 Bot Token 和 Chat ID 后，扩展会把凭据保存在本地。只有在用户点击发送测试，或启用 Telegram 通知并触发通知发送时，扩展才会请求 `https://api.telegram.org/*`。发送内容包括 Bot Token、Chat ID，以及与通知相关的佬有料摘要文本。

已配置的 Telegram Bot Token / Chat ID 会随配置导出和云存档备份迁移。用户应把导出的 JSON 当作包含通知凭据的私密备份保存。

### GitHub API 和镜像

扩展界面打开时会请求 `https://api.github.com/*` 检查最新 GitHub Release，并使用 12 小时缓存；当 GitHub API 检查失败且符合回退条件时，会请求 `https://github-api.lafish.workers.dev/*`。这些请求用于版本更新提示，不会上传佬朋友列表、打捞规则、Telegram 凭据或 linux.do 活动数据。

### linuxdo-cloud-save.lafish.workers.dev

用户绑定云存档后，扩展会请求 `https://linuxdo-cloud-save.lafish.workers.dev/*` 完成绑定、检查状态、备份和恢复。备份会上传可迁移配置，包括佬朋友及其备注、打捞规则、请求统计、设置，以及已配置的 Telegram Bot Token / Chat ID。每日自动备份只有在用户绑定云存档并开启对应开关后才会运行。

云存档绑定令牌保存在本地扩展存储中。断开绑定会清除本地云存档授权并停止后续自动备份；当前扩展前端不会把“断开绑定”解释为删除远端备份。

## 使用目的

扩展使用这些数据仅用于：

- 展示和管理用户自己的 linux.do 佬朋友视图。
- 低频或用户触发地刷新用户可见的公开活动。
- 保存用户设置、打捞规则和请求统计。
- 提供用户启用的本地通知、Telegram 通知、云存档备份/恢复，以及扩展界面打开时的版本更新提示。
- 诊断刷新状态和请求统计。

扩展不会出售用户数据，不会把数据用于广告或画像，不会把 linux.do 请求转发到第三方代理服务。

## 保留和删除

- 本地数据保留在浏览器扩展存储中，直到用户清理缓存、全量重置、导入覆盖配置、卸载扩展，或通过浏览器清除扩展数据。
- Telegram Bot Token 和 Chat ID 可在通知设置中清空；清空后不会再用于后续 Telegram 请求，但历史导出文件或历史云备份仍可能包含旧凭据。
- 云存档断开绑定会清除本地云存档令牌并停止后续自动备份；远端备份的删除能力不由当前扩展前端提供。发布前如果新增远端删除入口，应同步更新本政策。
- Telegram、GitHub、Cloudflare Worker 和 linux.do 服务端可能按各自服务策略保留访问日志或消息记录。

## 用户控制

用户可以：

- 手动触发或关闭刷新、通知和每日自动备份。
- 导出、导入或覆盖可迁移配置。
- 清理本地缓存，或执行全量重置恢复到刚安装状态。
- 清空 Telegram Bot Token / Chat ID。
- 断开云存档本地绑定。
- 卸载扩展并通过浏览器清除扩展存储。

## Chrome Web Store Limited Use

The use of information received from Chrome extension APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## 联系

问题可通过 GitHub 仓库 Issues 提交：`https://github.com/LeUKi/linuxdo-friends/issues`。不要在公开 Issue 中粘贴 Token、Cookie 或个人数据；发布到商店前如需处理云存档远端删除请求，应补充维护者邮箱或其他私密联系渠道。
