# 通讯录群聊

## 位置与职责

- 源码位置：`src/pages/workspace/directory/groups/`。
- 界面位置：通讯录群聊分类和选中群聊后的右侧资料面板。

## 文件说明

| 文件                                         | 功能                                               |
| -------------------------------------------- | -------------------------------------------------- |
| [GroupList.vue](GroupList.vue)               | 群分类展开、名称筛选、群头像及选择事件             |
| [GroupDetailPanel.vue](GroupDetailPanel.vue) | 选中群资料、加载或错误状态、返回目录及进入群聊入口 |

## 调用关系

列表由 [FriendDirectory.vue](../FriendDirectory.vue) 使用，
详情由 [ChatWorkspace.vue](../../ChatWorkspace.vue) 展示，
群头像复用 [GroupAvatar.vue](../../../../components/avatar/GroupAvatar.vue)。
实际请求由 [useChatDirectory.ts](../useChatDirectory.ts) 协调。
聊天内的成员管理和群公告编辑属于 [ChatDetailsPanel.vue](../../conversation/ChatDetailsPanel.vue)，不在本目录。
