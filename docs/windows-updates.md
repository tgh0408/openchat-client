# Windows 发布与更新

## 当前发布条件

当前仓库配置了 Windows x64 的 electron-builder NSIS 安装包，但还存在以下与发布直接相关的缺口：

| 项目               | 当前状态与影响                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 自定义安装脚本     | `package.json` 的 `build.nsis.include` 指向 `build/installer.nsh`，当前仓库没有该文件；需要补齐脚本或调整配置后才能正常制作 NSIS 安装包 |
| 升级和卸载数据保留 | 仓库没有可执行的自定义安装清理实现，不能承诺覆盖升级、旧版首次升级或卸载保留程序旁数据                                                  |
| 公共资源自动校验   | `scripts/verify-packaged-public.ts` 有校验函数，但当前打包脚本和配置没有调用它；不能宣称打包已自动检查全部资源摘要和重复副本            |
| 依赖锁定           | 当前仓库没有依赖锁文件，含版本范围的依赖在重新安装时可能解析为不同版本                                                                  |

以上是当前仓库事实，不是已经完成的发布保证。发布时需要先处理对应工程配置，再生成和确认实际交付产物。

## 构建命令

安装依赖及配置环境后：

```bash
npm run build
```

该命令执行类型检查、前端构建和 Electron 入口构建。已经构建的应用可使用 `npm start` 启动。

解决安装脚本缺失后，生成安装包：

```bash
npm run package:win
```

该命令先构建应用，再由 `scripts/package-win.ts` 运行 Windows x64 NSIS 打包。成功后扫描 `release/` 中的 `.exe` 并生成同名 `.sha256` 文件。

只需要目录产物时，可在完成构建后执行现有目录模式入口：

```bash
node --experimental-strip-types scripts/run-tool.ts tsx scripts/package-win.ts --dir
```

目录模式不生成安装程序和安装包摘要，也不能证明 NSIS 安装流程可用。

## 安装配置与产物

| 项目     | 配置                                  |
| -------- | ------------------------------------- |
| 应用标识 | `com.openchat`                        |
| 产品名称 | `OpenChat`                            |
| 版本     | 读取 `package.json` 的 `version`      |
| 目标     | Windows x64 / NSIS                    |
| 输出目录 | `release/`                            |
| 安装包名 | `openchat-<version>-setup.exe`        |
| 摘要文件 | `openchat-<version>-setup.exe.sha256` |
| 安装界面 | 非一键安装，允许选择安装目录          |
| 快捷方式 | 桌面和开始菜单快捷方式                |
| 默认图标 | `public/ico/openchat.ico`             |

安装配置将页面、Electron 入口和运行时依赖放入 ASAR，并对需要外置加载的原生模块及 OCR 子进程入口解包。公共资源通过 `extraFiles` 放在与 `OpenChat.exe` 同级的 `public/`。

Vite 页面位于 `dist/index.html` 和 `dist/assets/`，Electron 入口位于 `dist-electron/*.cjs`。安装配置不收录浏览器构建生成的第二份公共资源。

原生数据库、OCR、视频工具、窗口与输入支持依赖必须随安装包保留。只分发 `dist/` 或 `dist-electron/` 不足以运行完整桌面应用。

## 更新检查

设置页调用 `GET /capi/update/public/latest`。服务端成功响应中的 `data: null` 表示没有可用发布记录；其他响应需要以下字段：

| 字段          | 作用                         |
| ------------- | ---------------------------- |
| `releaseId`   | 正整数发布标识               |
| `version`     | 三段式数字版本，例如 `1.0.0` |
| `clientName`  | 安装包文件名                 |
| `fileSize`    | 文件字节数                   |
| `sha256`      | 安装包 SHA-256 摘要          |
| `downloadUrl` | HTTP 或 HTTPS 下载地址       |
| `updateInfo`  | 版本说明字符串数组           |

只有服务端版本高于本地版本时返回可更新记录。设置页和更新页接收可展示的发布信息，实际下载地址和校验逻辑保留在主进程。

## 下载与安装

1. 设置页发现新版本后打开独立更新窗口，显示版本和更新说明。
2. 用户选择升级时打开专属确认窗口；取消、关闭或 Escape 结束本次确认。
3. 确认后重新查询发布信息，验证 `releaseId` 未变化，再开始下载。
4. 文件先写入应用目录 `updates/` 下的临时文件，并向页面报告进度。
5. 下载结束校验实际字节数和 SHA-256；不一致则失败并清理临时文件。
6. 校验成功后启动 Windows `.exe` 或 `.msi` 安装程序，当前应用退出以释放文件锁。

当前流程不执行差分更新。忽略本次更新只关闭窗口，不持久化忽略版本。更新窗口关闭、重载或账号失效时取消对应操作；浏览器模式没有自动安装入口。

## 数据与版本维护

应用运行数据位于程序旁的 `database/`、`file/`、`backups/`、`.runtime/` 等目录。当前 `deleteAppDataOnUninstall: false` 配置不能替代程序安装目录的数据保留实现。

在安装脚本补齐并确认其行为之前，不依赖旧文档中的“升级和卸载必定保留数据”描述。数据库结构也没有通用迁移框架，保留文件不代表任意旧版本内容库均可直接打开。

更新服务发布的摘要必须对应实际交付文件。随包公共资源说明见 [运行与构建](getting-started.md)，数据库与备份范围见 [数据与存储](storage.md)。

## 源码定位

- `package.json`：版本、打包目标、文件清单、资源和安装配置。
- `scripts/package-win.ts`：Windows 打包入口及安装包摘要生成。
- `scripts/verify-packaged-public.ts`：公共资源清单、摘要和重复内容校验函数。
- `electron/pages/update/`：版本服务、下载、安装启动和确认窗口。
- `shared/update/update.ts`：版本字段解析及版本比较。
- `src/pages/update/`：更新说明、进度及操作结果界面。
