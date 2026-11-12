# 通讯录好友

## 位置与职责

- 源码位置：`src/pages/workspace/directory/friends/`。
- 界面位置：通讯录的联系人分类、右侧好友详情，以及黑名单或删除确认弹窗。

## 文件说明

| 文件                                                   | 功能                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [FriendList.vue](FriendList.vue)                       | 联系人分类展开、首字母分组、名称或 UID 过滤及选择事件                        |
| [FriendDetailPanel.vue](FriendDetailPanel.vue)         | 展示真实好友资料、备注电话及关系状态，提供聊天、备注、黑名单和删除等适用入口 |
| [FriendBlacklistDialog.vue](FriendBlacklistDialog.vue) | 加入黑名单的确认界面及提交错误展示；移出不使用此确认框                       |
| [FriendDeleteDialog.vue](FriendDeleteDialog.vue)       | 删除联系人确认、可选清空聊天记录及提交状态；通过调用方提供的操作完成删除     |

## 调用关系

列表由 [FriendDirectory.vue](../FriendDirectory.vue) 使用，详情由
[ChatWorkspace.vue](../../ChatWorkspace.vue) 展示，数据由 [useChatDirectory.ts](../useChatDirectory.ts) 协调。
两个确认弹窗也被 [FriendProfileWindow.vue](../../../contacts/profile/FriendProfileWindow.vue) 复用。
选择好友只读取资料，点击“发消息”才进入真实会话。
