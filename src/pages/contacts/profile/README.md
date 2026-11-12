# 好友与群成员资料窗口

## 位置与职责

- 源码位置：`src/pages/contacts/profile/`。
- 界面位置：聊天设置侧栏点击单聊头像或群成员头像后显示的独立资料浮窗。
- 加载入口：`#friend-profile`。

## 文件说明

| 文件                                               | 功能                                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [FriendProfileWindow.vue](FriendProfileWindow.vue) | 读取绑定对象资料，按好友、非好友或本人显示内容；提供发消息、好友申请、备注、黑名单及删除联系人等适用操作 |

## 调用关系

由 [工作台会话详情](../../workspace/conversation/README.md) 发起，
通过 `window.friendProfileDesktop` 与 `electron/pages/contacts/profile/` 协作。
复用 [好友目录](../../workspace/directory/friends/README.md) 的黑名单和删除确认弹窗，
并可打开 [备注](../remark/README.md) 或 [申请](../application/README.md) 窗口。
与通讯录右侧内嵌资料面板不同，本目录负责独立浮窗；不自行选择任意用户或恢复授权。
