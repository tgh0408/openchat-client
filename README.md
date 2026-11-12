# OpenChat

OpenChat 是基于 Electron、Vue 3 和 TypeScript 的桌面即时通信客户端，提供账号登录与注册、好友和群聊、消息收发、附件传输、音视频通话及本地聊天记录管理。

客户端连接 OpenChat 后端完成身份认证、消息同步和资源授权。当前安装包配置面向 **Windows x64**；浏览器模式用于页面开发，完整桌面能力通过 Electron 提供。

## 功能概览

| 模块         | 已实现功能                                                           | 详细文档                                    |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------- |
| 账号与认证   | 密码登录、注册、头像裁剪、历史账号选择、会话恢复、退出登录           | [账号与认证](docs/authentication.md)        |
| 聊天与会话   | 单聊、群聊、文件助手、会话搜索、置顶、免打扰、未读定位、独立聊天窗口 | [聊天与消息](docs/messaging.md)             |
| 消息交互     | 文本、图片、视频、文件、语音、表情、引用、撤回、本地删除、历史查询   | [聊天与消息](docs/messaging.md)             |
| 通讯录       | 好友搜索与申请、验证、备注与标签、黑名单、删除联系人                 | [联系人与群组](docs/contacts-and-groups.md) |
| 群组         | 创建群聊、成员管理、群名称与公告、退出群聊、群主解散                 | [联系人与群组](docs/contacts-and-groups.md) |
| 媒体与附件   | 拖放和粘贴草稿、分片上传、下载、图片预览、视频播放、语音录制         | [媒体与附件](docs/media-and-files.md)       |
| 截图         | 区域截图、Windows 窗口吸附、纵向双向滚动拼接                         | [桌面截图](docs/screenshot.md)              |
| 图片文字识别 | 本地 OCR、图片文字选区、文本编辑与复制、结果缓存                     | [图片文字识别](docs/image-ocr.md)           |
| 音视频通话   | 单聊语音与视频、群通话、来电处理、设备切换、降噪、通话恢复           | [音视频通话](docs/rtc.md)                   |
| 桌面与设置   | 系统托盘、未读提醒、多窗口、日志等级、版本检查与更新下载             | [桌面与设置](docs/desktop-and-settings.md)  |
| 数据与存储   | 按账号隔离的加密内容库、本地媒体缓存、内容库在线备份接口             | [数据与存储](docs/storage.md)               |

全部文档从 [docs 文档目录](docs/README.md) 进入；源码布局见 [项目结构](docs/project-structure.md)。

## 开发环境

- Node.js 22.12.0 或更高版本及 npm。
- 可访问的 OpenChat 后端服务。
- 使用通话功能时，需配套 RTC 信令、LiveKit 和可用的媒体网络。
- 项目目录必须可写，以保存依赖、构建产物及运行数据。

参考 [.env.example](.env.example) 创建 `.env.local`，填写实际服务地址和与后端一致的平台标识：

```dotenv
VITE_AUTH_API_BASE=
VITE_RTC_SERVER_URL=
VITE_CLIENT_ID_PC=
VITE_CLIENT_ID_PHONE=
VITE_CLIENT_ID_WEB=
```

模板不提供默认业务服务器或平台标识，运行前须填写实际配置。`.env` 和 `.env.*` 本地配置已被 Git 忽略，仅提交空值模板 `.env.example`。远程认证服务使用 HTTPS；回环地址允许 HTTP。配置在构建时写入产物，修改后须重新启动开发进程或重新构建。完整配置说明见 [运行与构建](docs/getting-started.md)。

```bash
npm run setup
npm run dev
```

`setup` 通过项目启动器安装依赖并将缓存放在项目内。`dev` 编译 Electron 入口后启动桌面应用及 Vite；Vue 页面支持热更新，主进程和 preload 修改后需要重启。

浏览器页面开发：

```bash
npm run dev:web
```

默认地址为 `http://127.0.0.1:5173`。浏览器模式没有 SQLite 持久化、系统托盘和原生子窗口等完整桌面能力。

## 构建与发布

```bash
npm run build
npm start
```

`build` 执行类型检查并生成 `dist/` 和 `dist-electron/`；`start` 运行构建后的桌面应用。

Windows 安装包入口为：

```bash
npm run package:win
```

成功打包后的安装程序与 SHA-256 校验文件位于 `release/`。

**当前仓库仍有安装包发布阻塞：** `package.json` 引用了未随仓库提供的 `build/installer.nsh`。发布前需要补齐安装脚本或调整安装配置；现状不能视为已具备可直接交付的安装包。具体产物布局、更新流程和发布限制见 [Windows 发布与更新](docs/windows-updates.md)。

## 数据位置

开发时数据位于项目根目录；安装后位于 `OpenChat.exe` 所在目录。主要目录为 `database/`、`file/`、`backups/`、`log/` 和 `.runtime/`。安装位置必须可写。

用户内容库使用后端提供的密钥打开，登录会话使用系统安全存储加密。公共 OCR 缓存和附件文件具有不同的存储边界，不能将整个安装目录视为加密存储。备份范围和数据保留说明见 [数据与存储](docs/storage.md)。

## 技术组成

| 层次       | 实现                                             |
| ---------- | ------------------------------------------------ |
| 桌面运行时 | Electron                                         |
| 页面与组件 | Vue 3、Element Plus、vue-element-plus-x          |
| 开发与构建 | TypeScript、Vite、electron-builder               |
| 本地数据库 | better-sqlite3-multiple-ciphers                  |
| 实时通信   | HTTP API、SSE、WebRTC、LiveKit                   |
| 媒体处理   | Artplayer、FFmpeg、FFprobe、DeepFilterNet3       |
| 图片识别   | ppu-paddle-ocr、ONNX Runtime、本地 PP-OCRv6 模型 |

依赖版本和脚本以 [package.json](package.json) 为准。类型和格式检查使用 `npm run check`。

## 许可证

项目许可证见 [LICENSE](LICENSE)。随项目提供的第三方资源说明位于 [public/licenses](public/licenses/) 和 [OCR 模型许可](public/ocr/LICENSE-PaddleOCR.txt)。
