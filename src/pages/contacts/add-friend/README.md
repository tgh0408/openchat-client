# 添加朋友窗口

## 位置与职责

- 源码位置：`src/pages/contacts/add-friend/`。
- 界面位置：工作台会话列表上方更多菜单中的“添加朋友”独立窗口。
- 加载入口：[main.ts](../../../main.ts) 的 `#add-friend`。

## 文件说明

| 文件                                       | 功能                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| [AddFriendWindow.vue](AddFriendWindow.vue) | 搜索输入、搜索中和失败状态、用户不存在提示、资料结果、已有好友发消息及陌生人申请入口 |

## 调用关系

由 [ChatWorkspace.vue](../../workspace/ChatWorkspace.vue) 请求打开。
通过 `window.addFriendDesktop` 调用受控能力，
对应 [add-friend-window.ts](../../../../electron/pages/contacts/add-friend/add-friend-window.ts) 和
[add-friend-preload.ts](../../../../electron/pages/contacts/add-friend/add-friend-preload.ts)。
“添加到通讯录”进入 [好友申请窗口](../application/README.md)，已有好友“发消息”回到主工作台的真实会话。

## 当前边界

搜索框当前提示为“搜索手机号或邮箱号”。关系由主进程查询确认，不将查询失败视为陌生人。
地区、朋友圈和共同群聊仍为未提供或空状态。已有好友的语音、视频复用主工作台通话流程。
右上角三点按钮通过 `window.contextMenuHost` 复用启动时预加载、关闭后隐藏常驻的菜单窗口，
保持资料卡的 `mac` 主题及 `chat-context-menu` 样式，按当前好友性别和黑名单状态生成菜单项。
备注和标签、黑名单、删除联系人复用既有表单、确认框和主进程业务入口；
权限、推荐和星标尚未接入，保持禁用。删除成功后关闭本搜索窗口。
菜单及操作始终绑定原窗口、原搜索结果和授权；重新搜索、关闭或切换账号后不接受旧结果。
修改搜索词或卸载后丢弃旧结果，搜索资料不在本页面持久化。
