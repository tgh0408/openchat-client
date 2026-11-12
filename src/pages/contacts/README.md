# 联系人独立窗口

## 位置与职责

- 源码位置：`src/pages/contacts/`。
- 界面位置：由工作台或好友资料操作打开的联系人辅助窗口。
- 这里不是主窗口通讯录列表；列表和详情面板位于 [workspace/directory](../workspace/directory/README.md)。

## 子目录

| 目录                                 | 功能与入口                                                            |
| ------------------------------------ | --------------------------------------------------------------------- |
| [add-friend](add-friend/README.md)   | 搜索用户、添加朋友，`#add-friend`                                     |
| [application](application/README.md) | 发起好友申请和通过验证，`#friend-application`、`#friend-verification` |
| [profile](profile/README.md)         | 好友或群成员资料浮窗，`#friend-profile`                               |
| [remark](remark/README.md)           | 编辑备注、标签、电话和描述，`#friend-remark`                          |

窗口控制及专属 preload 位于 `electron/pages/contacts/` 对应子目录。
子窗口沿用主进程绑定的授权和目标，不初始化另一套账号或数据库。
