# 通讯录

## 位置与职责

- 源码位置：`src/pages/workspace/directory/`。
- 界面位置：点击左侧通讯录导航后的搜索、分类列表及右侧资料区域。
- 直接调用方：[ChatWorkspace.vue](../ChatWorkspace.vue)。

## 文件与子目录

| 文件或目录                                 | 功能                                                               |
| ------------------------------------------ | ------------------------------------------------------------------ |
| [FriendDirectory.vue](FriendDirectory.vue) | 组织搜索输入、好友、群聊和新的朋友分类，并转发选择事件             |
| [useChatDirectory.ts](useChatDirectory.ts) | 列表和详情请求、目录选择、好友申请审批、未读同步及异步请求失效处理 |
| [directory-list.css](directory-list.css)   | 各分类复用的列表样式，由分类组件按现有 scoped 方式引入             |
| [friends](friends/README.md)               | 好友列表、详情和关系操作确认                                       |
| [groups](groups/README.md)                 | 群聊列表和群资料详情                                               |
| [applications](applications/README.md)     | 新的朋友分类、申请列表和申请详情                                   |

## 协作边界

会话选择和摘要更新仍交给工作台，目录不创建第二套授权、聊天存储或 SSE。
此处是工作台内嵌通讯录；添加朋友、资料浮窗、备注及申请表单见
[pages/contacts](../../contacts/README.md)。
