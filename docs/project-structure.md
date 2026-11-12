# 项目结构

## 分层

```text
openchat-client/
  docs/                 功能、运行和发布文档
  src/
    pages/              页面及页面专属逻辑
    components/         跨页面复用的组件
    services/           渲染层请求、存储、媒体及交互逻辑
    assets/             内置表情等编译资源
    main.ts             按窗口 hash 动态加载入口
    App.vue             浏览器模式的登录和工作台生命周期
  electron/
    main-bootstrap.ts   轻量启动入口
    pages/              窗口控制、专属 preload 和页面业务
    services/           认证、数据库、网络、媒体和运行服务
  shared/               两端共用的协议、类型、校验与计算
  public/               图标、音效、模型、降噪和资源许可
  scripts/              安装启动器、构建与打包工具
```

前端由 Vue 负责展示和交互，原生文件、窗口、系统能力及 SQLite 由 Electron 主进程管理，preload 暴露按用途限制的桥接。`shared/` 中的 Node 专用工具隔离在 `runtime/node/`，不能当作浏览器模块引用。

## 主工作台

| 模块           | 前端位置                                        | 主进程位置                                         |
| -------------- | ----------------------------------------------- | -------------------------------------------------- |
| 登录与注册     | `src/pages/login/`                              | `electron/services/auth/`、`electron/pages/login/` |
| 工作台总编排   | `src/pages/workspace/`                          | `electron/pages/workspace/main.ts`、`preload.ts`   |
| 标题和导航     | `src/pages/workspace/navigation/`               | 工作台主入口                                       |
| 最近会话       | `src/pages/workspace/conversations/`            | `electron/pages/workspace/conversations/`          |
| 通讯录编排     | `src/pages/workspace/directory/`                | `electron/pages/workspace/directory/`              |
| 好友与申请     | `directory/friends/`、`directory/applications/` | 对应好友和申请服务                                 |
| 群列表与创建   | `src/pages/workspace/directory/groups/`         | `electron/pages/workspace/directory/groups/`       |
| 聊天标题和详情 | `src/pages/workspace/conversation/`             | 工作台入口和聊天服务                               |
| 收藏表情       | `src/pages/workspace/emoji/`                    | 聊天服务与表情协议                                 |
| 通话入口       | `src/pages/workspace/rtc/`                      | `electron/pages/rtc/`                              |
| 提示与确认     | `src/pages/workspace/feedback/`、`dialogs/`     | 各操作对应服务                                     |
| 消息和输入     | `src/components/chat/`                          | `electron/services/chat/`、`media/`                |

`conversations` 表示会话列表，`workspace/conversation` 表示当前聊天详情，`pages/conversation` 表示独立聊天窗口。它们共享授权、数据库和资源事件，不分别初始化同一业务连接。

## 窗口入口

以下页面路径相对于 `src/pages/`，原生控制器位于 `electron/pages/` 的对应目录。

| Hash                                          | 页面路径                                           | 功能文档                                 |
| --------------------------------------------- | -------------------------------------------------- | ---------------------------------------- |
| 默认入口                                      | `login/LoginWindow.vue`                            | [账号与认证](authentication.md)          |
| `#workspace`                                  | `workspace/WorkspaceWindow.vue`                    | [聊天与消息](messaging.md)               |
| `#conversation`                               | `conversation/ConversationWindow.vue`              | [聊天与消息](messaging.md)               |
| `#history`                                    | `history/HistoryWindow.vue`                        | [聊天与消息](messaging.md)               |
| `#settings`                                   | `settings/SettingsWindow.vue`                      | [桌面与设置](desktop-and-settings.md)    |
| `#image-preview`                              | `image-preview/ImagePreviewWindow.vue`             | [媒体与附件](media-and-files.md)         |
| `#video-player`                               | `video-player/VideoPlayerWindow.vue`               | [媒体与附件](media-and-files.md)         |
| `#screenshot`                                 | `screenshot/ScreenshotWindow.vue`                  | [桌面截图](screenshot.md)                |
| `#avatar-crop`                                | `avatar-crop/AvatarCropWindow.vue`                 | [账号与认证](authentication.md)          |
| `#add-friend`                                 | `contacts/add-friend/AddFriendWindow.vue`          | [联系人与群组](contacts-and-groups.md)   |
| `#friend-profile`                             | `contacts/profile/FriendProfileWindow.vue`         | [联系人与群组](contacts-and-groups.md)   |
| `#friend-remark`                              | `contacts/remark/FriendRemarkWindow.vue`           | [联系人与群组](contacts-and-groups.md)   |
| `#friend-application`、`#friend-verification` | `contacts/application/FriendApplicationWindow.vue` | [联系人与群组](contacts-and-groups.md)   |
| `#rtc-call`                                   | `rtc/RtcCallWindow.vue`                            | [音视频通话](rtc.md)                     |
| `#rtc-device-menu`                            | `rtc/device-menu/RtcMicrophoneMenuWindow.vue`      | [音视频通话](rtc.md)                     |
| `#context-menu`                               | `context-menu/ContextMenuWindow.vue`               | [桌面与设置](desktop-and-settings.md)    |
| `#tray-preview`                               | `tray-preview/TrayPreviewWindow.vue`               | [桌面与设置](desktop-and-settings.md)    |
| `#update`                                     | `update/UpdateWindow.vue`                          | [Windows 发布与更新](windows-updates.md) |
| `#update-confirm`                             | `update/UpdateConfirmWindow.vue`                   | [Windows 发布与更新](windows-updates.md) |

`src/main.ts` 动态导入当前页面，避免登录首屏提前加载所有媒体和通话模块。浏览器没有桌面桥接时，由 `App.vue` 管理登录与工作台。

## 公共组件与服务

| 路径                                            | 职责                                   |
| ----------------------------------------------- | -------------------------------------- |
| `src/components/avatar/`                        | 普通头像、群组合头像及联系人头像       |
| `src/components/avatar-crop/`                   | 复用头像裁剪编辑器                     |
| `src/components/icons/`                         | 置顶及扬声器图标                       |
| `src/components/contacts/`                      | 联系人选择                             |
| `src/components/chat/messages/`                 | 消息内容、引用、定位、复制和拖动       |
| `src/components/chat/composer/`                 | 输入、录音、草稿和收藏操作             |
| `src/components/chat/attachments/`、`feedback/` | 附件卡片和反馈                         |
| `src/services/auth/`、`storage/`、`events/`     | 页面认证、存储调用与资源事件分发       |
| `src/services/chat/`                            | 排序、分页、正文缓存、重试、撤回和未读 |
| `src/services/media/`                           | 图片来源、视频队列、语音与音效         |
| `src/services/context-menu/`、`runtime/`        | 菜单和公共资源地址                     |

通话专属服务放在 `src/pages/rtc/services/`，包括 WebRTC、LiveKit、降噪、输出设备、群成员和质量控制。

| 主进程目录                    | 职责                                       |
| ----------------------------- | ------------------------------------------ |
| `electron/services/auth/`     | 授权、系统加密、设备与平台                 |
| `electron/services/database/` | 设置、用户和公共库，数据库 IPC             |
| `electron/services/network/`  | API 客户端与唯一资源 SSE                   |
| `electron/services/chat/`     | 发送、历史、已读、会话清理、附件操作和头像 |
| `electron/services/media/`    | 图片、OCR、视频、文件、语音及草稿          |
| `electron/services/ipc/`      | 通用调用校验、窗口通知与桥接               |
| `electron/services/runtime/`  | 启动、路径、图标、托盘和进程支持           |
| `electron/services/logging/`  | 日志、脱敏、请求记录和诊断                 |

## 共享协议

| 目录               | 内容                                 |
| ------------------ | ------------------------------------ |
| `shared/api/`      | API 客户端、请求头、响应及错误       |
| `shared/auth/`     | 登录注册、设备、会话失效和头像       |
| `shared/chat/`     | 会话、消息、资源事件及表情           |
| `shared/contacts/` | 好友、申请、群组、备注和显示名       |
| `shared/media/`    | 媒体内容、草稿、限制、OCR 与截图计算 |
| `shared/rtc/`      | 呼叫、协商、设备与事件               |
| `shared/windows/`  | 各窗口桥接及上下文                   |
| `shared/storage/`  | 持久化实体和查询类型                 |
| `shared/update/`   | 版本解析和更新进度                   |
| `shared/runtime/`  | 启动阶段及 Node 工具环境             |

## 构建入口

`vite.config.ts` 负责页面构建、公共资源和 CSP，`vite.electron.config.ts` 显式映射全部桌面入口。`scripts/electron-build.ts` 顺序构建主入口、业务入口、OCR 子进程和各 preload，每个入口独立输出到 `dist-electron/`。

`scripts/run-tool.ts` 统一工具运行目录，`scripts/dev.ts` 管理开发服务与 Electron，`scripts/typecheck-vue.ts` 适配 Vue 类型检查，`scripts/package-win.ts` 执行 Windows 打包。

构建产物不应手动修改。窗口及媒体实现变更后需要完整重启桌面进程；运行配置见 [运行与构建](getting-started.md)。
