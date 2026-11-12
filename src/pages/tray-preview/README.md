# 托盘未读预览

## 位置与职责

- 源码位置：`src/pages/tray-preview/`。
- 界面位置：鼠标悬浮系统托盘图标时显示的未读会话浮层。
- 加载入口：`#tray-preview`。

## 文件说明

| 文件                                           | 功能                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| [TrayPreviewWindow.vue](TrayPreviewWindow.vue) | 展示未读会话头像、名称和数量，点击进入会话，以及“暂不处理”和关闭交互 |

## 调用关系

通过 `window.trayPreviewDesktop` 接收 `electron/pages/tray-preview/` 管理的快照，
头像复用 [avatar](../../components/avatar/README.md)。
点击由主进程恢复工作台并选择绑定会话；“暂不处理”仅暂停当前提醒，不标记会话已读。
浮层不自行查询任意会话、写数据库或创建资源 SSE。
