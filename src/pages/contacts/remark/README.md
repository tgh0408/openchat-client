# 备注和标签窗口

## 位置与职责

- 源码位置：`src/pages/contacts/remark/`。
- 界面位置：通讯录好友详情或独立资料窗中“设置备注和标签”打开的原生表单。
- 加载入口：`#friend-remark`。

## 文件说明

| 文件                                             | 功能                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [FriendRemarkWindow.vue](FriendRemarkWindow.vue) | 读取真实备注资料，编辑备注名、标签、电话和描述；检测修改、提交保存、取消及错误展示 |

## 调用关系

调用方为 [FriendDetailPanel.vue](../../workspace/directory/friends/FriendDetailPanel.vue) 和
[FriendProfileWindow.vue](../profile/FriendProfileWindow.vue)。
通过 `window.friendRemarkDesktop` 使用 `electron/pages/contacts/remark/` 的专属桥接。
目标和编辑版本由主进程固定，未提交草稿只在当前窗口内存中；不提供备注图片或任意文件访问。
