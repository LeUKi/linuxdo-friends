# Firefox AMO 提交说明

佬朋友的 Firefox 发布目标是 Firefox Desktop 140+。AMO 提交保持手工完成，仓库和 GitHub Actions 不配置 Mozilla secrets，不执行 `web-ext sign`，也不调用 AMO API。

## 本地构建

使用 Node.js 22：

```bash
npm ci
npm test
npm run typecheck
npm run build:firefox
npm run lint:firefox
npm run package:firefox -- --name linuxdo-friends-v1.5.2-firefox.zip
```

构建产物：

- `dist-firefox/`：Firefox 临时加载目录。
- `packages/linuxdo-friends-v1.5.2-firefox.zip`：提交给 AMO 的未签名扩展包。

Firefox manifest 会由构建脚本生成，包含 `sidebar_action`、`background.scripts`、`browser_specific_settings.gecko.id`、最低 Firefox `140.0`，以及 AMO 内置数据授权声明。`required: ["none"]` 表示没有安装时必选数据收集；Telegram、云存档和更新检查的数据类别声明在 `optional` 中，并在用户触发对应功能时请求。

`web-ext lint` 可能给出 Firefox for Android 最低版本提示；本项目只向 AMO 提交 Firefox Desktop 版本。React 运行时和 content script 中只写入仓库内固定 SVG 模板的 `innerHTML` 警告需要在 AMO 审核说明中如实标注，lint 必须保持零 error。

## Firefox Desktop 手工冒烟

在 Firefox 140+ 中临时载入 `dist-firefox/manifest.json`，然后检查：

- 工具栏按钮和 Firefox 侧栏菜单可打开完整侧栏。
- linux.do 页面入口会尝试打开侧栏；如 Firefox 拒绝消息转发后的 `sidebarAction.open()`，页面必须显示明确错误和“打开设置”恢复入口。
- options、linux.do 页面增强、手动刷新和浏览器本地通知正常。
- Telegram 发送测试或保存并开启时请求对应数据授权，拒绝后不发送也不启用。
- 云存档绑定、备份、恢复和开启自动备份时请求对应数据授权，拒绝后不联网。
- 首次手动检查更新时请求对应数据授权，拒绝后不请求 GitHub。
- 在 `about:addons` 撤销各类授权后，Telegram、云存档和更新检查应停止对应外联，本地功能不受影响。

## AMO 上传

在同一个 GitHub tag 下提交：

- 扩展包：上传 `packages/linuxdo-friends-vX.Y.Z-firefox.zip`。
- 源码：上传 GitHub Release 页面自动提供的 `Source code (zip)`。

不要上传额外的 `firefox-source.zip`。GitHub 自动源码包已经对应同一 tag 的完整仓库源码。

AMO 审核通过后会生成签名后的正式 Firefox 安装包；GitHub Release 中的 Firefox ZIP 不是最终签名安装包。

## AMO 描述页字段

- Summary：`本地管理 linux.do 佬朋友，主动刷新状态和公开动态。`
- Description：使用 README 的项目介绍和功能列表，明确 local-first、Firefox 侧栏、手动刷新、可选 Telegram 与云存档能力。
- Category：选择 AMO 当前可用的社交与沟通类目。
- License：`MIT License`。
- Homepage：`https://github.com/LeUKi/linuxdo-friends`
- Support website：`https://github.com/LeUKi/linuxdo-friends/issues`
- Support email：在 AMO 后台填写维护者的私密联系邮箱，不提交到仓库。
- Privacy policy：`https://github.com/LeUKi/linuxdo-friends/blob/main/docs/privacy-policy.md`
- Icon：使用扩展包内的 `icons/icon-128.png`。

建议至少上传侧栏主列表、佬友圈和设置页三张截图。截图中不要包含真实 Telegram Token、Chat ID、云存档凭据或其他私密数据。

## v1.5.2 发布说明

```text
首次提供 Firefox Desktop 版本，保留完整侧栏、页面增强、好友刷新和佬友圈功能。增加 Firefox 数据授权与 session 状态兼容，并修复合法动态 JSON 和普通 Turnstile 组件被误判为 Cloudflare 页面验证的问题。
```

## Reviewer Notes

提交版本时将以下说明填入 AMO Reviewer Notes：

```text
This add-on targets Firefox Desktop 140 and later. It is not submitted for Firefox for Android.

Reproducible build instructions are in AMO_BUILD.md. The reference toolchain is Node.js 22.20.0, npm 10.9.3, and the committed package-lock.json. Run npm ci, npm test, npm run typecheck, npm run build:firefox, npm run lint:firefox, and npm run package:firefox -- --name linuxdo-friends-v1.5.2-firefox.zip.

The web-ext lint warnings about innerHTML come from React runtime output and three content-script assignments that insert repository-owned fixed SVG icon templates. No network response or user-provided HTML is assigned to innerHTML. Source maps are included for review.

The add-on does not download or execute remote code. Network access is limited to linux.do, Telegram API, GitHub release checks and the documented cloud-save service. Telegram, cloud-save and update-check transmissions require the declared optional Firefox data collection permissions. Revoking those permissions stops the related external requests.
```
