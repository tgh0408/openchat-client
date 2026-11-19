# 工作台通话入口

## 位置与职责

- 源码位置：`src/pages/workspace/rtc/`。
- 所属位置：聊天标题栏通话按钮、群通话邀请、历史回拨及工作台内的通话确认弹窗。
- 直接调用方：[ChatWorkspace.vue](../ChatWorkspace.vue)。

## 文件说明

| 文件                                           | 功能                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [useWorkspaceRtc.ts](useWorkspaceRtc.ts)       | 协调单聊通话发起、群成员邀请、来电事件、历史回拨及独立通话窗口状态 |
| [RtcRedialDialog.vue](RtcRedialDialog.vue)     | 强制呼出的应用内确认，默认选择否，Escape 取消                      |
| [RtcRecoveryDialog.vue](RtcRecoveryDialog.vue) | 登录后的通话重连或挂断确认                                         |

## 调用关系

按钮在 [ChatConversationHeader.vue](../conversation/ChatConversationHeader.vue)，
群邀请界面在 [RtcInviteMemberDialog.vue](../dialogs/RtcInviteMemberDialog.vue)。
实际通话窗口、媒体采集和设备控制位于 [pages/rtc](../../rtc/README.md)。
此处复用工作台已有资源 SSE，不新建连接，也不把独立通话窗口的媒体逻辑放回主工作台。

群入口通过 `rtcGetGroupActiveCall` 查询 `GET /capi/rtc/rooms/{roomId}/active`。
存在通话时沿原 callId 加入，已退出、拒绝、邀请过期或未受邀均可主动进入；
仅明确返回 null 时选择成员新建。当前设备已参与时直接打开原窗口，
主动重入成功后回收仍在收尾的旧窗口，再初始化媒体。
查询失败不回退创建，其他设备仍在参与时不抢占。
安卓与 PC 的共同契约见 `openchat-server/resource/rtc-group-entry.md`。
