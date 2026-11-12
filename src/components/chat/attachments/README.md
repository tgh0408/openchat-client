# 附件展示

## 位置与职责

- 源码位置：`src/components/chat/attachments/`。
- 界面位置：输入区的附件草稿及聊天、历史中的文件消息卡片。

## 文件说明

| 文件                                             | 功能                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| [FileAttachmentCard.vue](FileAttachmentCard.vue) | 统一展示附件名称、大小和按扩展名选择的图标，并为调用方保留内容插槽 |

## 调用关系

由 [MessageComposer.vue](../composer/MessageComposer.vue) 和 [FileMessage.vue](../messages/FileMessage.vue) 使用。
本组件只定义外观，不决定上传类型，不执行上传、下载或文件打开操作。
