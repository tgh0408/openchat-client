# 最近会话列表

## 位置与职责

- 源码位置：`src/pages/workspace/conversations/`。
- 界面位置：主工作台导航栏右侧的最近会话栏。
- 直接调用方：[ChatWorkspace.vue](../ChatWorkspace.vue)。

## 文件说明

| 文件                                               | 功能                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| [ConversationSidebar.vue](ConversationSidebar.vue) | 搜索和更多菜单、基于 `FixedSizeList` 的虚拟列表、键盘导航、右键操作及拖出独立窗口 |
| [ConversationRow.vue](ConversationRow.vue)         | 单个会话的头像、名称、消息摘要、时间、未读数量和选中状态                          |

## 协作边界

列表沿用工作台提供的顺序，不重新承担远端同步或已读更新。
普通头像及群头像来自 [avatar](../../../components/avatar/README.md)。
拖出或右键打开的窗口位于 [pages/conversation](../../conversation/README.md)，
当前聊天标题和设置侧栏则位于同级 [conversation](../conversation/README.md)。
