# 联系人选择组件

## 位置与职责

- 源码位置：`src/components/contacts/`。
- 界面位置：聊天设置侧栏发起添加或移出群成员时显示的选择弹窗。

## 文件说明

| 文件                                               | 功能                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| [ContactPickerDialog.vue](ContactPickerDialog.vue) | 搜索、首字母分组、勾选联系人、展示已选项和提交状态；支持调用方限制不可选成员 |

## 调用关系

当前由 [ChatDetailsPanel.vue](../../pages/workspace/conversation/ChatDetailsPanel.vue) 使用，
头像复用 [AvatarImage.vue](../avatar/AvatarImage.vue)。
列表、可选范围和提交操作由调用方提供，组件不自行请求添加或移出接口。
群通话邀请使用工作台的 [RtcInviteMemberDialog.vue](../../pages/workspace/dialogs/RtcInviteMemberDialog.vue)，不是本组件。
