# 视频播放窗口

## 位置与职责

- 源码位置：`src/pages/video-player/`。
- 界面位置：聊天或历史中的视频已下载后，点击播放打开的独立窗口。
- 加载入口：`#video-player`。

## 文件说明

| 文件                                           | 功能                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| [VideoPlayerWindow.vue](VideoPlayerWindow.vue) | 基于 Artplayer 播放绑定视频，恢复和上报播放位置，提供从头播放及加载失败重试 |

## 调用关系

入口来自 [VideoMessage.vue](../../components/chat/messages/VideoMessage.vue)，
通过 `window.videoPlayerDesktop` 与 `electron/pages/video-player/` 协作。
播放器使用主进程提供的受控本地媒体来源，不在失败时改为任意远端 URL；
下载、兼容处理和缓存访问权限由主进程负责。
