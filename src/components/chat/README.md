# 聊天公共组件

## 位置与职责

- 源码位置：`src/components/chat/`。
- 界面位置：主工作台、独立聊天窗口和聊天记录窗口中的消息、草稿及反馈区域。

## 子目录

| 目录                                 | 功能与位置                               |
| ------------------------------------ | ---------------------------------------- |
| [attachments](attachments/README.md) | 文件消息和输入草稿中的附件外观           |
| [composer](composer/README.md)       | 聊天底部输入区、录音、引用草稿和准备进度 |
| [feedback](feedback/README.md)       | 居中操作反馈和消息定位高亮               |
| [messages](messages/README.md)       | 消息列表、各类消息内容、引用和定位按钮   |

## 调用关系

[ChatWorkspace.vue](../../pages/workspace/ChatWorkspace.vue) 编排消息列表和输入区，
[ConversationWindow.vue](../../pages/conversation/ConversationWindow.vue) 通过复用工作台使用这些组件。
[ChatHistory.vue](../../pages/history/ChatHistory.vue) 复用消息内容及高亮，不使用发送输入区。
历史页面的只读权限不能因复用消息组件而扩大。
