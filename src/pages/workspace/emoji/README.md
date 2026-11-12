# 工作台收藏表情逻辑

## 位置与职责

- 源码位置：`src/pages/workspace/emoji/`。
- 所属位置：聊天输入区表情面板的数据层，本目录没有独立 Vue 界面。
- 直接调用方：[ChatWorkspace.vue](../ChatWorkspace.vue)。

## 文件说明

| 文件                                           | 功能                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| [useWorkspaceEmojis.ts](useWorkspaceEmojis.ts) | 读取收藏缓存、刷新远端列表、删除和移到最前，并协调忙碌状态及旧请求失效 |

## 调用关系

展示及菜单位于 [MessageComposer.vue](../../../components/chat/composer/MessageComposer.vue)，
发送仍由工作台统一处理。
消息右键“添加到表情”的提交和反馈位于
[useEmojiCollection.ts](../../../components/chat/composer/useEmojiCollection.ts)，与本目录的列表管理职责不同。
