# 消息展示与交互

## 位置与职责

- 源码位置：`src/components/chat/messages/`。
- 界面位置：聊天中部的消息流、历史搜索结果、引用摘要及消息区定位按钮。
- 主要调用方：[ChatWorkspace.vue](../../../pages/workspace/ChatWorkspace.vue) 和 [ChatHistory.vue](../../../pages/history/ChatHistory.vue)。

## 文件说明

| 文件                                             | 功能                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [ChatMessageList.vue](ChatMessageList.vue)       | 基于 `BubbleList` 的虚拟消息列表；分页、阅读位置、发送状态、消息菜单、已读观测及未读和引用定位 |
| [ImageMessage.vue](ImageMessage.vue)             | 普通图片展示、缓存读取、失败重试、独立预览及适用的图片菜单                                     |
| [EmojiMessage.vue](EmojiMessage.vue)             | 图片表情展示、加载失败重试及适用的收藏、引用和撤回菜单                                         |
| [VideoMessage.vue](VideoMessage.vue)             | 视频封面、上传占位和进度、取消或重发、下载及独立播放入口                                       |
| [FileMessage.vue](FileMessage.vue)               | 文件及上传占位卡片、传输状态、重试和文件操作菜单                                               |
| [VoiceMessage.vue](VoiceMessage.vue)             | 语音秒数、按消息读取音频、播放或停止及播放动画                                                 |
| [RtcCallMessage.vue](RtcCallMessage.vue)         | 通话结果摘要与回拨事件                                                                         |
| [SystemMessage.vue](SystemMessage.vue)           | 群成员变更等系统消息的文本展示                                                                 |
| [MessageQuote.vue](MessageQuote.vue)             | 文本及媒体引用摘要，共用于消息引用和输入草稿                                                   |
| [ReplyMessage.vue](ReplyMessage.vue)             | 读取已保存的引用关系，显示原文摘要、失效占位及定位菜单                                         |
| [MessageJumpButton.vue](MessageJumpButton.vue)   | 通用消息定位按钮，展示文案、忙碌状态并发出跳转事件                                             |
| [ReplyReturnButton.vue](ReplyReturnButton.vue)   | 封装返回引用位置按钮，复用通用定位按钮                                                         |
| [useMessageCopy.ts](useMessageCopy.ts)           | 复制操作及反馈，避免组件复用后操作旧消息                                                       |
| [useMessageDrag.ts](useMessageDrag.ts)           | 通过受控能力将真实附件文件拖出客户端                                                           |
| [reply-menu.ts](reply-menu.ts)                   | 引用菜单项的共用构造和样式                                                                     |
| [message-delete-menu.ts](message-delete-menu.ts) | 复用消息列表提供的本地删除权限及删除菜单样式                                                   |

## 协作边界

文本气泡由列表和历史页面直接展示，没有独立的文本消息组件。
历史页面复用消息内容组件，不复用主聊天的整个虚拟列表，也不因此获得发送、删除或收藏权限。
媒体访问提交消息标识，资源读取及归属检查沿用既有服务和专属桥接；引用不递归展开引用链。
