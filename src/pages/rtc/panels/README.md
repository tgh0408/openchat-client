# 通话展示面板

## 位置与职责

- 源码位置：`src/pages/rtc/panels/`。
- 界面位置：独立通话窗口的主体画面和控制区。
- 直接调用方：[RtcCallWindow.vue](../RtcCallWindow.vue)，没有单独的页面 hash。

## 文件说明

| 文件                                           | 功能                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [RtcAudioCallPanel.vue](RtcAudioCallPanel.vue) | 语音来电紧凑布局和完整通话布局、头像、状态、接听或挂断及音频控制 |
| [RtcCallPanel.vue](RtcCallPanel.vue)           | 单聊视频主画面、可拖动画中画、画面交换、媒体绑定及通话控制       |
| [RtcGroupCallPanel.vue](RtcGroupCallPanel.vue) | 群成员网格、邀请等待和发言状态、成员音视频元素及通话控制         |

## 协作边界

面板通过属性接收真实通话状态，通过事件交回操作和设备按钮坐标。
信令及设备状态由父窗口和 [services](../services/README.md) 协调，
原生设备菜单位于 [device-menu](../device-menu/README.md)。
通话中添加成员、共享屏幕等禁用入口不能描述为已经可用。
