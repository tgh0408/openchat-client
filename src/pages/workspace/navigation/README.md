# 工作台导航与标题栏

## 位置与职责

- 源码位置：`src/pages/workspace/navigation/`。
- 界面位置：工作台顶部窗口控制区及最左侧导航栏。
- 直接调用方：[ChatWorkspace.vue](../ChatWorkspace.vue)。

## 文件说明

| 文件                                 | 功能                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| [ChatTitleBar.vue](ChatTitleBar.vue) | 窗口置顶、最小化、最大化或还原及关闭按钮，通过事件交回工作台             |
| [ChatNavRail.vue](ChatNavRail.vue)   | 个人头像与资料浮层、聊天和通讯录切换、文件助手、未读角标及左下角更多菜单 |

## 调用关系

头像复用 [avatar](../../../components/avatar/README.md)，置顶图标来自
[icons](../../../components/icons/README.md)。
窗口和账号操作由工作台调用受控能力；导航按钮不自行恢复授权或创建会话。
