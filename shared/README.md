# 共享模块目录

此目录存放页面、Electron 主进程、preload 或构建脚本复用的协议、类型、校验、请求及计算逻辑。
它不是公共 UI 组件目录，也不代表所有文件都能在浏览器运行。

## 目录导航

| 目录                  | 职责                                               | 主要文件                                                                                    |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `api/`                | 绑定会话的请求客户端、请求头、响应与授权校验       | `api-client.ts`、`api-request.ts`、`api-response.ts`                                        |
| `auth/`               | 登录、注册、用户资料、设备标识和授权失效协议       | `auth.ts`、`device-identity.ts`、`session-invalidation.ts`、`registration-avatar.ts`        |
| `chat/`               | 聊天请求与表情收藏协议                             | `chat.ts`、`emoji.ts`                                                                       |
| `chat/conversations/` | 会话置顶、删除及拖动协议                           | `conversation-preferences.ts`、`conversation-deletion.ts`、`conversation-drag.ts`           |
| `chat/messages/`      | 资源消息、消息状态、撤回、下载、拖动和各类消息正文 | `resource-message.ts`、`message-state.ts`、`recall-message.ts` 等                           |
| `contacts/`           | 好友、群组、申请、关系查询及名称解析               | `friend.ts`、`group.ts`、`friend-application.ts`、`friend-profile.ts`、`contact-name.ts` 等 |
| `media/`              | 跨类型媒体草稿协议                                 | `media-drafts.ts`                                                                           |
| `media/image/`        | 图片内容、预览坐标计算和头像裁剪校验               | `image.ts`、`image-viewport.ts`、`avatar-crop.ts`                                           |
| `media/video/`        | 视频内容、上传协议及格式限制                       | `video.ts`、`video-formats.ts`                                                              |
| `media/voice/`        | 语音内容及相关接口                                 | `voice.ts`                                                                                  |
| `media/file/`         | 文件消息、附件访问及下载协议                       | `file-message.ts`                                                                           |
| `media/screenshot/`   | 截图选区校验、窗口接口及长截图拼接计算             | `screenshot.ts`、`screenshot-stitch.ts`                                                     |
| `rtc/`                | 通话信令、媒体协商、设备菜单状态和校验             | `rtc.ts`、`rtc-media.ts`、`rtc-microphone.ts`                                               |
| `windows/`            | 主页面及独立窗口的桥接契约、绑定上下文与通道限制   | `desktop.ts`、`conversation-window.ts`、`image-preview.ts`、`rtc-call-window.ts` 等         |
| `storage/`            | 持久化实体、查询条件与设置类型，不操作 SQLite      | `database.ts`                                                                               |
| `update/`             | 版本查询、更新信息与下载进度协议                   | `update.ts`                                                                                 |
| `runtime/`            | 两端共用的启动阶段及顺序                           | `startup.ts`                                                                                |
| `runtime/node/`       | **仅供 Node 使用**的运行环境与缓存目录配置         | `local-environment.ts`                                                                      |

## 如何定位

- 登录会话：`auth/auth.ts`；真实桌面授权状态仍由 `electron/services/auth/` 管理。
- 普通请求：`api/api-client.ts` 的 `requestApi` 负责传输，已登录操作使用 `createApiClientFactory` 的绑定客户端。
- 请求错误：`api/api-error.ts` 提取后端 `errMsg`；`api/api-response.ts` 统一 HTTP、业务响应及授权失效分类；preload 复用 `electron/services/ipc/invoke.ts` 清理调用包装。
- 平台请求头：`auth/client-identity.ts` 维护与后端一致的 PC/PHONE/WEB 固定值；`auth/device-identity.ts` 在设备初始化时固定平台，业务请求统一携带 `clientId`。
- 消息类型与 SSE 聊天正文：`chat/messages/resource-message.ts`。
- 热群订阅完成后的补历史提示：`chat/messages/room-history-sync.ts`，不是聊天记录或已读确认。
- 页面能调用哪些桌面能力：`windows/desktop.ts`；具体执行逻辑仍在主进程。
- 共用独立菜单：`windows/context-menu.ts` 定义展示数据白名单、来源桥接、显示代次及屏幕边界计算；不传递业务回调或账号凭据。
- 会话和消息数据库实体：`storage/database.ts`；建表与查询实现在 `electron/services/database/`。
- 图片预览窗口接口：`windows/image-preview.ts`；缩放和平移计算在 `media/image/image-viewport.ts`。
- 主窗口对应模块与所有页面入口：参阅 [项目目录索引](../docs/project-structure.md)。

## 维护边界

- 业务方法仅配置路径、请求体和响应解析器，不重复捕获 HTTP/业务错误；公共层不弹窗、不自动重试。
  `parse` 接收成功响应外壳，独立解析器复用 `parseApiResult`，业务层只维护 data 校验及业务状态。
  例如好友分页使用 `api.request({ path: '/capi/user/friend/page', method: 'POST', body: { pageSize, cursor }, serviceName: '好友联系人', parse: parseFriendPage })`。
  登录等公开请求以 `requestApi({ base }, options)` 调用；上传控制接口传入已绑定的 session 和 validateCurrent。
  SSE、OSS 字节流及公开资源不使用 JSON 请求入口。具体规则见根目录 `CLAUDE.md` 的认证约定。

- 优先按业务领域归档，不重新平铺到 `shared/` 根目录，也不建立混合所有业务的 `utils/` 或 `types/`。
- 模块仍按文件直接导入，不增加聚合所有模块的 `index.ts`，避免提前加载无关代码。
- 目录调整保留原文件名、导出名称、请求协议及校验逻辑；请求封装变动同步维护调用方及隔离回归。
- `windows/` 放独立的窗口桥接契约；与业务校验、坐标计算紧密结合的接口仍随其业务模块，不为目录分类重复定义类型。
- `runtime/node/` 使用 Node 文件系统和进程能力，禁止渲染页面或沙箱 preload 引用；前端类型检查排除此目录，Node 类型检查仍覆盖它。
- 由 Node 直接执行的脚本保留 `.ts` 导入扩展名，例如 `scripts/run-tool.ts` 引入 `runtime/node/local-environment.ts`。
- 不在这里引入 Vue 组件、Electron 窗口实现、数据库连接或账号持久化状态。
