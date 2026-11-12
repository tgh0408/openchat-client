# 通话设备菜单

## 位置与职责

- 源码位置：`src/pages/rtc/device-menu/`。
- 界面位置：通话窗口麦克风、扬声器或摄像头按钮旁的独立悬浮菜单。
- 加载入口：`#rtc-device-menu`。

## 文件说明

| 文件                                                       | 功能                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [RtcMicrophoneMenuWindow.vue](RtcMicrophoneMenuWindow.vue) | 按当前设备类型展示列表、选中状态和开关；音频模式提供音量，处理尺寸回报、指针缓冲及键盘焦点 |

## 调用关系

虽然文件名保留 `Microphone`，当前三类设备共用此页面，不是三个菜单窗口。
通过 `window.rtcMicrophoneDesktop` 与
`electron/pages/rtc/device-menu/rtc-microphone-window.ts` 及其 preload 协作，
命令交回 [RtcCallWindow.vue](../RtcCallWindow.vue) 执行。
菜单本身不枚举或采集设备，不建立媒体连接；旧显示代次的操作不能作用于新设备模式。
