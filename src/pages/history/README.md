# 聊天记录窗口

## 位置与职责

- 源码位置：`src/pages/history/`。
- 界面位置：聊天标题栏或聊天设置中的历史入口打开的独立窗口。
- 加载入口：`#history`。

## 文件说明

| 文件                                   | 功能                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| [HistoryWindow.vue](HistoryWindow.vue) | 从专属桥接读取绑定会话上下文，提供查询函数及原生窗口控制                     |
| [ChatHistory.vue](ChatHistory.vue)     | 搜索关键词、消息分类、日期筛选、分页、引用定位与返回，以及媒体和通话记录展示 |

## 调用关系

使用 `window.historyDesktop`，主进程对应 `electron/pages/history/`。
复用 [消息内容组件](../../components/chat/messages/README.md)、[头像](../../components/avatar/README.md) 和
[行高亮](../../components/chat/feedback/README.md)，不直接复用整个 `ChatMessageList`。
历史查询限于绑定会话的本地记录，不因搜索推进已读，也不开放普通消息发送或删除权限。
