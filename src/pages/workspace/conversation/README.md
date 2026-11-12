# 当前聊天标题与详情

## 位置与职责

- 源码位置：`src/pages/workspace/conversation/`。
- 界面位置：当前聊天区域的顶部标题栏和右侧展开的聊天设置侧栏。
- 直接调用方：[ChatWorkspace.vue](../ChatWorkspace.vue)。

## 文件说明

| 文件                                                     | 功能                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [ChatConversationHeader.vue](ChatConversationHeader.vue) | 当前会话名称、历史入口、聊天设置开关和单聊或群聊通话入口                         |
| [ChatDetailsPanel.vue](ChatDetailsPanel.vue)             | 单聊或群聊资料、成员列表、群名称和公告编辑、成员添加或移出、置顶及历史和清空入口 |
| [GroupAnnouncement.vue](GroupAnnouncement.vue)           | 群公告展示及编辑状态下的输入、保存和取消交互                                     |
| [useWorkspaceContacts.ts](useWorkspaceContacts.ts)       | 工作台头像与名称缓存、并发资料请求合并及失败重试控制，没有独立 UI                |

## 调用关系

成员选择复用 [ContactPickerDialog](../../../components/contacts/README.md)，
点击资料头像可打开 [好友资料窗口](../../contacts/profile/README.md)。
消息列表和输入区在 [公共聊天组件](../../../components/chat/README.md)，不在此目录。
本目录 `conversation` 指当前会话区域，不是同级 `conversations` 列表，也不是顶层独立聊天入口。
