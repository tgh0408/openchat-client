# 好友申请与验证

## 位置与职责

- 源码位置：`src/pages/contacts/application/`。
- 界面位置：添加朋友或资料窗中的申请表单，以及通讯录“新的朋友”的验证表单。
- 加载入口：`#friend-application` 和 `#friend-verification` 共用同一 Vue 页面。

## 文件说明

| 文件                                                       | 功能                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [FriendApplicationWindow.vue](FriendApplicationWindow.vue) | 根据窗口入口切换申请或验证模式；编辑申请说明、备注、标签和预留权限选项，提交、取消及失败保留草稿 |

## 调用关系

申请来自 [添加朋友](../add-friend/README.md) 或 [资料窗口](../profile/README.md)，
验证来自 [通讯录申请详情](../../workspace/directory/applications/README.md)。
使用 `window.friendApplicationDesktop` 或 `window.friendVerificationDesktop`，
对应 `electron/pages/contacts/application/` 中的窗口控制器和两类 preload。
目标身份由主进程绑定，普通申请提交成功只表示已发送申请，不直接表示已成为好友。
