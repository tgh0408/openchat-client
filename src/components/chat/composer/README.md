# 消息输入区

## 位置与职责

- 源码位置：`src/components/chat/composer/`。
- 界面位置：主聊天和独立聊天的底部输入区域，以及消息收藏操作的配套逻辑。
- 主要调用方：[ChatWorkspace.vue](../../../pages/workspace/ChatWorkspace.vue)。

## 文件说明

| 文件                                                         | 功能                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [MessageComposer.vue](MessageComposer.vue)                   | 文字输入、表情面板、附件草稿、截图入口、引用草稿、输入区高度及发送事件 |
| [VoiceRecorder.vue](VoiceRecorder.vue)                       | 主动录音、真实波形、计时、取消及 WAV 上传；完成后通知工作台创建消息    |
| [DraftPreparationProgress.vue](DraftPreparationProgress.vue) | 文件和视频草稿的准备阶段、实际读取进度及状态展示                       |
| [ReplyDraftPreview.vue](ReplyDraftPreview.vue)               | 输入框内的待发送引用摘要及取消入口，复用 `MessageQuote`                |
| [useEmojiCollection.ts](useEmojiCollection.ts)               | 普通图片和表情消息共用的收藏提交及反馈状态，并非表情面板列表管理器     |

## 协作边界

输入区通过事件交给工作台处理发送和草稿生命周期，不能将 HTTP 提交成功当作送达。
附件外观来自 [attachments](../attachments/README.md)，引用内容来自 [messages](../messages/README.md)。
收藏列表读取、删除和排序由 [工作台 emoji](../../../pages/workspace/emoji/README.md) 管理。
