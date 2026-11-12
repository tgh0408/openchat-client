# 新的朋友

## 位置与职责

- 源码位置：`src/pages/workspace/directory/applications/`。
- 界面位置：通讯录“新的朋友”分类、申请列表及右侧申请详情。

## 文件说明

| 文件                                                         | 功能                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| [FriendApplicationSection.vue](FriendApplicationSection.vue) | 分类标题、展开状态、未读角标和申请列表的组合                     |
| [FriendApplicationList.vue](FriendApplicationList.vue)       | 申请分页、已加载项搜索、头像、邀请语、方向与状态、选中及加载更多 |
| [FriendApplicationDetail.vue](FriendApplicationDetail.vue)   | 展示申请人或对方资料、完整邀请语和状态，按条件提供前往验证入口   |

## 调用关系

分类由 [FriendDirectory.vue](../FriendDirectory.vue) 使用，
详情由 [ChatWorkspace.vue](../../ChatWorkspace.vue) 展示，
列表及未读协调由 [useChatDirectory.ts](../useChatDirectory.ts) 负责。
“前往验证”打开 [FriendApplicationWindow.vue](../../../contacts/application/FriendApplicationWindow.vue)
的 `#friend-verification` 模式；本目录不是提交申请的独立表单。
收到和发出的申请状态分别展示，不能对发出的申请执行接收方审批。
