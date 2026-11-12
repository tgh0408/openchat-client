# 截图页面

## 位置与职责

- 源码位置：`src/pages/screenshot/`。
- 界面位置：聊天输入区发起截图后覆盖显示器的选区界面，以及滚动截图过程中的预览。
- 加载入口：`#screenshot`，由主进程按屏幕和任务管理。

## 文件说明

| 文件                                                       | 功能                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [ScreenshotWindow.vue](ScreenshotWindow.vue)               | 屏幕快照展示、窗口候选框选、选区移动和缩放、确认或取消、滚动截图启动及任务状态处理 |
| [ScrollScreenshotPreview.vue](ScrollScreenshotPreview.vue) | 滚动截图拼接预览、当前画面范围和采集状态展示                                       |
| [screenshot-paint.ts](screenshot-paint.ts)                 | 提供等待 DOM 绘制机会的辅助方法，也被聊天输入区截图入口复用                        |

## 调用关系

[MessageComposer.vue](../../components/chat/composer/MessageComposer.vue) 发出截图事件，由工作台调用原生能力。
页面通过 `window.screenshotDesktop` 与 `electron/pages/screenshot/` 协作。
成功结果返回原会话图片草稿，不自动发送；滚动截图已接入，未实现的标注工具仍禁用。
协议和模块说明见 [截图共享模块](../../../shared/media/screenshot/README.md)。
