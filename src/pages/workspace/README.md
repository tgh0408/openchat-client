# 主聊天工作台

## 位置与职责

- 源码位置：`src/pages/workspace/`。
- 界面位置：登录后的导航、会话或通讯录列表、聊天或资料详情三栏主界面。
- 桌面入口：`#workspace`；浏览器由 [App.vue](../../App.vue) 按授权状态加载。

## 文件说明

| 文件                                       | 功能                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [WorkspaceWindow.vue](WorkspaceWindow.vue) | 读取已验证会话，承接授权生命周期，并在会话初始化和首帧就绪后通知主进程                         |
| [ChatWorkspace.vue](ChatWorkspace.vue)     | 工作台整体编排、会话选择、消息和草稿、历史加载、资源事件处理、已读及窗口操作；也供独立聊天复用 |

## 子目录

| 目录                                     | 功能与界面位置                                 |
| ---------------------------------------- | ---------------------------------------------- |
| [navigation](navigation/README.md)       | 顶部窗口控制和最左侧导航、个人资料浮层         |
| [conversations](conversations/README.md) | 中间最近会话列表、单行、右键菜单及拖出窗口     |
| [conversation](conversation/README.md)   | 当前聊天标题、右侧聊天设置和联系人资料缓存逻辑 |
| [directory](directory/README.md)         | 通讯录搜索、好友、群聊和新的朋友分类及详情     |
| [dialogs](dialogs/README.md)             | 删除或清空确认、群通话邀请成员弹窗             |
| [feedback](feedback/README.md)           | 工作台错误及通知提示                           |
| [emoji](emoji/README.md)                 | 输入区收藏表情的数据、刷新及排序逻辑           |
| [rtc](rtc/README.md)                     | 通话发起、群邀请和历史回拨入口逻辑             |

## 调用关系

消息列表和输入区来自 [公共聊天组件](../../components/chat/README.md)，不是本目录下的重复实现。
主进程业务入口和 preload 位于 `electron/pages/workspace/`。
`conversations` 是会话列表，`conversation` 是当前聊天区域；顶层
[pages/conversation](../conversation/README.md) 则是独立聊天窗口入口。
这些视图复用已有授权和数据服务，不分别建立数据库或资源 SSE。
