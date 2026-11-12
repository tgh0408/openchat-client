# 头像裁剪窗口

## 位置与职责

- 源码位置：`src/pages/avatar-crop/`。
- 界面位置：桌面注册表单选择头像后打开的独立模态窗口。
- 加载入口：`#avatar-crop`。

## 文件说明

| 文件                                         | 功能                                                             |
| -------------------------------------------- | ---------------------------------------------------------------- |
| [AvatarCropWindow.vue](AvatarCropWindow.vue) | 读取本次选图、承载裁剪编辑器、提交结果和取消，并展示读取失败状态 |

## 调用关系

注册入口位于 [LoginPanel.vue](../login/LoginPanel.vue)，编辑区域复用
[AvatarCropEditor.vue](../../components/avatar-crop/AvatarCropEditor.vue)。
通过 `window.avatarCropDesktop` 与 `electron/pages/avatar-crop/` 协作。
此窗口不启动认证或内容库；取消不替换原注册头像，确认后也不直接上传。
