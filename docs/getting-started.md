# 运行与构建

## 环境与服务

项目要求 Node.js >= 22.12.0。桌面入口由 Electron 运行，安装配置面向 Windows x64。其他平台没有对应安装包脚本，不能由通用页面代码推导出已支持的平台发行版。

运行前准备可访问的 OpenChat 后端。聊天依赖认证、会话、消息、资源 SSE 和附件授权接口；音视频通话还依赖 RTC 服务及 LiveKit。仓库不包含后端部署程序。

项目及安装目录必须可写。工具启动器和桌面程序把其管理的缓存、临时文件、日志及数据库放在应用目录内，目录创建失败不会自动改用其他数据位置。

## 环境配置

Vite 读取项目环境文件。参考 [.env.example](../.env.example) 创建 `.env.local`，填写本机配置：

```dotenv
VITE_AUTH_API_BASE=
VITE_RTC_SERVER_URL=
VITE_CLIENT_ID_PC=
VITE_CLIENT_ID_PHONE=
VITE_CLIENT_ID_WEB=
```

| 变量                   | 用途与要求                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `VITE_AUTH_API_BASE`   | 业务后端基础地址。允许 HTTPS，以及 localhost、127.0.0.1、IPv6 回环地址的 HTTP；拒绝带用户名、密码、查询参数或片段的地址 |
| `VITE_RTC_SERVER_URL`  | 将指定 RTC 服务的 WebSocket 和对应 HTTP 来源加入页面 CSP；使用 `ws://` 或 `wss://`，与服务端返回的 LiveKit 地址对应     |
| `VITE_CLIENT_ID_PC`    | 桌面请求的公开平台标识，与后端 PC 配置一致                                                                              |
| `VITE_CLIENT_ID_PHONE` | 共享平台映射中的 PHONE 标识，构建环境同样需要提供                                                                       |
| `VITE_CLIENT_ID_WEB`   | 浏览器请求的平台标识，与后端 WEB 配置一致                                                                               |

模板不包含默认业务服务器或平台标识，使用前须填写部署环境的实际配置。`.env` 和 `.env.*` 均被 Git 忽略，仅保留空值 `.env.example` 供分发。平台标识不是 JWT 签名密钥；不要在这些变量中放认证密钥。所有变量进入构建产物，安装版不会在启动时重新读取旁边的 `.env`。

桌面请求由主进程发出。浏览器模式直接访问后端，需要对应的跨域配置；仅启动 Vite 不会提供业务代理或登录服务。RTC 跨网络使用应配置参与者均可访问的服务地址，实际媒体地址和凭证由后端下发。

## 安装与启动

在项目根目录执行：

```bash
npm run setup
npm run dev
```

`setup` 使用 `scripts/run-tool.ts` 启动 npm，统一设置项目内的下载缓存和临时目录。附加安装参数可通过 `npm run setup -- <参数>` 传递。该隔离环境不会自动沿用用户主目录里的全部工具配置。

`dev` 先构建 Electron 主进程和各 preload，再启动 Vite 与桌面应用。页面支持热更新；主进程、原生模块或 preload 修改后重新运行该命令。开发服务随 Electron 进程退出而清理；已登录工作台关闭按钮会隐藏到托盘，完全结束开发运行应退出应用。

仅启动页面：

```bash
npm run dev:web
```

默认监听 `http://127.0.0.1:5173`，端口被占用时不会自动换端口，可显式指定：

```bash
npm run dev:web -- --port 5174
```

浏览器模式可以进行页面开发，但数据源驻留内存，且不具备原生窗口、桌面截图、SQLite、系统托盘等能力。

## 命令索引

| 命令                     | 作用                                               |
| ------------------------ | -------------------------------------------------- |
| `npm run setup`          | 安装依赖                                           |
| `npm run dev`            | 构建桌面入口并启动开发环境                         |
| `npm run dev:web`        | 启动 Vite 页面开发服务                             |
| `npm run typecheck`      | 检查 Vue 页面、Electron、共享模块和脚本的类型      |
| `npm run typecheck:vue`  | 通过项目适配脚本检查 Vue 页面                      |
| `npm run typecheck:node` | 检查 Node 与 Electron 侧类型                       |
| `npm run build`          | 类型检查后构建前端及 Electron                      |
| `npm run build:electron` | 单独构建 Electron 入口，并检查 OCR 公共资源        |
| `npm start`              | 通过 Electron 运行已经构建的应用                   |
| `npm run preview`        | 用 Vite 预览已构建的前端页面                       |
| `npm run package:win`    | 构建并生成 Windows x64 NSIS 安装包，前提见发布文档 |
| `npm run check`          | 类型检查与格式检查                                 |
| `npm run format:check`   | 检查格式                                           |
| `npm run format`         | 格式化项目文件，会修改文件                         |

Vue 类型检查由 `scripts/typecheck-vue.ts` 使用 `@typescript/typescript6` 执行，Node 侧使用项目声明的 TypeScript。不要绕过适配脚本替换检查入口。

## 构建产物与资源

`dist/` 保存 Vite 页面，`dist-electron/` 保存独立 CommonJS 桌面入口。每个 preload 单独打包并内联共享代码，避免沙箱脚本加载本地拆分块。

`public/` 保存图标、头像、音效、通话图形、OCR 模型、降噪资源及资源许可证。浏览器构建复制公共资源；安装配置通过 `extraFiles` 将它们放在程序旁的 `public/`。

OCR 使用以下四个文件，构建过程不下载模型：

```text
public/ocr/PP-OCRv6_medium_det.onnx
public/ocr/PP-OCRv6_medium_rec.onnx
public/ocr/ppocrv6_dict.txt
public/ocr/LICENSE-PaddleOCR.txt
```

资源不可用时构建输出 OCR 警告并继续其他模块构建。运行中的识别入口还会检查模型和子进程入口，不能把构建成功等同于 OCR 可用。

Windows 打包配置、缺失的安装脚本和产物校验边界见 [Windows 发布与更新](windows-updates.md)。

## 常见问题

| 现象                         | 检查方向                                                       |
| ---------------------------- | -------------------------------------------------------------- |
| 无法登录或恢复账号           | 后端地址、平台标识、服务可达性，以及登录和 globalUid 响应      |
| 登录成功但消息连接异常       | SSE 连接状态、资源接口及后端授权；登录成功不代表实时连接已建立 |
| 浏览器请求失败               | 后端跨域配置、页面 CSP 与实际服务地址                          |
| 主进程修改未生效             | 完全退出 Electron 后重新启动                                   |
| 无法打开数据库或创建运行目录 | 程序目录写权限、数据库密钥和现有数据库结构                     |
| 无法识别图片文字             | 四个 OCR 资源、原生运行库及应用日志                            |
| 打包提示找不到 NSIS include  | 当前仓库缺少 `build/installer.nsh`，需处理后再制作安装包       |

日志位置和备份范围见 [数据与存储](storage.md)。
