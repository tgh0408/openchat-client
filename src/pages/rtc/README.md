# 音视频通话

## 位置与职责

- 源码位置：`src/pages/rtc/`。
- 界面位置：单聊语音、单聊视频或群通话的独立窗口，以及设备悬浮菜单。
- 通话入口：`#rtc-call`；设备菜单入口：`#rtc-device-menu`。

## 文件与子目录

| 文件或目录                             | 功能                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| [RtcCallWindow.vue](RtcCallWindow.vue) | 读取绑定呼叫、处理通话事件和终态，编排各类面板、媒体轨道、设备状态及窗口操作 |
| [panels](panels/README.md)             | 语音、视频和群通话的界面及媒体展示                                           |
| [services](services/README.md)         | RTC 状态控制、P2P 和 LiveKit、降噪、质量策略及音频输出                       |
| [device-menu](device-menu/README.md)   | 麦克风、扬声器和摄像头共用的独立设备菜单                                     |

## 调用关系

[工作台 RTC 逻辑](../workspace/rtc/README.md) 负责发起通话和处理来电入口。
原生窗口及桥接位于 `electron/pages/rtc/`，通话页面使用 `window.rtcCallDesktop`。
资源事件沿用主进程已有 SSE，页面不创建第二条资源连接；设备采集及媒体连接在通话结束时清理。
