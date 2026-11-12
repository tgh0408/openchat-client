# 工作台弹窗

## 位置与职责

- 源码位置：`src/pages/workspace/dialogs/`。
- 界面位置：覆盖在聊天工作台之上的操作确认或成员邀请弹窗。
- 直接调用方：[ChatWorkspace.vue](../ChatWorkspace.vue)。

## 文件说明

| 文件                                                   | 功能                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| [ChatDialogs.vue](ChatDialogs.vue)                     | 删除聊天和清空聊天记录的确认界面，展示忙碌状态并发送确认事件                |
| [RtcInviteMemberDialog.vue](RtcInviteMemberDialog.vue) | 群通话邀请与发起群聊共用的双栏选择弹窗；创建群聊时展示好友并限制最多 100 人 |

## 协作边界

删除和清空的实际操作由工作台执行，邀请流程由 [useWorkspaceRtc](../rtc/README.md) 协调。
这里是页内弹窗，不是 `src/main.ts` 独立窗口入口。
普通群成员添加或移出使用 [ContactPickerDialog](../../../components/contacts/README.md)，不要与通话邀请混淆。
