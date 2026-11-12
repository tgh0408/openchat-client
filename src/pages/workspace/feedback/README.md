# 工作台提示

## 位置与职责

- 源码位置：`src/pages/workspace/feedback/`。
- 界面位置：工作台中的错误和通知提示区域。
- 直接调用方：[ChatWorkspace.vue](../ChatWorkspace.vue)。

## 文件说明

| 文件                                 | 功能                                               |
| ------------------------------------ | -------------------------------------------------- |
| [ChatFeedback.vue](ChatFeedback.vue) | 展示错误或通知，按状态提供重试、重新登录和关闭入口 |

组件仅展示父级提供的状态并发送事件，不自行重试网络请求或清除账号。
窗口中央的收藏或好友操作反馈、消息行定位高亮位于
[公共 chat/feedback](../../../components/chat/feedback/README.md)。
