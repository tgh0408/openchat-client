# 聊天操作反馈

## 位置与职责

- 源码位置：`src/components/chat/feedback/`。
- 界面位置：窗口中央的短暂操作提示，以及聊天和历史消息定位后的整行背景。

## 文件说明

| 文件                                                       | 功能                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| [EmojiCollectionFeedback.vue](EmojiCollectionFeedback.vue) | 展示处理中、成功或失败浮层；图片收藏使用，工作台好友操作成功提示也复用 |
| [RowHighlight.vue](RowHighlight.vue)                       | 跟随目标消息行的位置和高度绘制短暂高亮背景，不占用消息布局             |
| [row-highlight.ts](row-highlight.ts)                       | 提供 `useRowHighlight`，统一高亮目标、持续时间及清理                   |

## 调用关系

[消息列表](../messages/ChatMessageList.vue) 和 [历史记录](../../../pages/history/ChatHistory.vue) 共用行高亮。
操作浮层由图片、表情消息及 [工作台](../../../pages/workspace/ChatWorkspace.vue) 提供真实状态，
组件本身不执行收藏或好友操作。工作台顶部错误条在 [workspace/feedback](../../../pages/workspace/feedback/README.md)。
