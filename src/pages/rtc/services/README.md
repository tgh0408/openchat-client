# 通话页面服务

## 位置与职责

- 源码位置：`src/pages/rtc/services/`。
- 所属位置：通话窗口背后的渲染层控制逻辑，本目录没有直接显示的 Vue 组件。
- 主要调用方：[RtcCallWindow.vue](../RtcCallWindow.vue)、[通话面板](../panels/README.md) 及 [工作台 RTC](../../workspace/rtc/README.md)。

## 文件说明

| 文件                                           | 功能                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| [index.ts](index.ts)                           | 导出 RTC API、客户端及关联类型                                    |
| [rtc-api.ts](rtc-api.ts)                       | 基于已绑定会话的 API 客户端封装 RTC 请求，并生成请求标识          |
| [rtc-client.ts](rtc-client.ts)                 | 通话状态和媒体生命周期，协调单聊直连、LiveKit、采集轨道及设备控制 |
| [rtc-direct.ts](rtc-direct.ts)                 | 单通话原生 WebRTC 适配、Offer/Answer 协商、轨道和直连状态处理     |
| [rtc-quality.ts](rtc-quality.ts)               | 从连接统计采样，计算视频质量档位和降档或恢复决策                  |
| [rtc-noise-filter.ts](rtc-noise-filter.ts)     | 本次通话的降噪音频图、采集输入替换、静音、增益及资源释放          |
| [rtc-speaker-output.ts](rtc-speaker-output.ts) | 实际播放元素的输出设备、音量和静音控制，以及切换失败处理          |
| [rtc-group-members.ts](rtc-group-members.ts)   | 合并真实入会成员与邀请占位，维护群通话成员展示                    |
| [rtc-error.ts](rtc-error.ts)                   | 设备及连接异常的中文提示和脱敏诊断                                |

## 协作边界

这些是页面专属媒体服务，不是 Electron 主进程服务。
独立窗口的请求权限仍由专属桥接约束，P2P 到 SFU 的切换依赖服务端确认，
不以本地布尔状态替代双方协调。
