# 页面目录

## 位置与职责

- 源码位置：`src/pages/`，按页面和窗口归属组织 Vue 组件、页面专属逻辑和样式。
- 入口：[src/main.ts](../main.ts) 按窗口 hash 动态加载；桌面默认加载登录页，浏览器默认通过 [App.vue](../App.vue) 切换登录和工作台。
- 原生窗口控制及 preload 位于对应的 `electron/pages/`；公共组件见 [components](../components/README.md)。

## 页面索引

| 目录                                     | 界面位置与入口                                        |
| ---------------------------------------- | ----------------------------------------------------- |
| [login](login/README.md)                 | 默认登录窗口，包含注册、账号选择和登录设置            |
| [workspace](workspace/README.md)         | 主聊天工作台，`#workspace`                            |
| [conversation](conversation/README.md)   | 绑定单个会话的独立聊天窗口，`#conversation`           |
| [history](history/README.md)             | 独立聊天记录搜索窗口，`#history`                      |
| [contacts](contacts/README.md)           | 添加朋友、资料、备注和申请验证等独立窗口              |
| [avatar-crop](avatar-crop/README.md)     | 注册头像裁剪窗口，`#avatar-crop`                      |
| [image-preview](image-preview/README.md) | 图片预览及 OCR，`#image-preview`                      |
| [video-player](video-player/README.md)   | 独立视频播放窗口，`#video-player`                     |
| [screenshot](screenshot/README.md)       | 屏幕框选和滚动截图，`#screenshot`                     |
| [rtc](rtc/README.md)                     | 音视频通话及设备菜单，`#rtc-call`、`#rtc-device-menu` |
| [settings](settings/README.md)           | 独立设置窗口，`#settings`                             |
| [update](update/README.md)               | 更新及确认窗口，`#update`、`#update-confirm`          |
| [tray-preview](tray-preview/README.md)   | 托盘悬浮未读会话预览，`#tray-preview`                 |

## 维护边界

hash 是渲染入口选择，不等于已经创建原生窗口或获得授权。
子窗口使用各自受控桥接，不自行恢复登录、打开内容库或建立第二条资源 SSE。
完整目录关系见 [项目结构](../../docs/project-structure.md)，功能说明见 [文档目录](../../docs/README.md)。
