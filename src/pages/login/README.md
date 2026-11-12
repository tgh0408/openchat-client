# 登录与注册

## 位置与职责

- 源码位置：`src/pages/login/`。
- 界面位置：应用启动后的登录窗口及其注册、登录设置界面。
- 加载入口：桌面由 [main.ts](../../main.ts) 默认加载；浏览器由 [App.vue](../../App.vue) 承载。

## 文件说明

| 文件                                           | 功能                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| [LoginWindow.vue](LoginWindow.vue)             | 启动阶段展示、历史账号恢复和选择、登录设置、授权进入及工作台窗口交接 |
| [LoginPanel.vue](LoginPanel.vue)               | 密码登录、快捷进入、注册表单、注册头像选择与裁剪、扫码占位           |
| [LoginAccountInput.vue](LoginAccountInput.vue) | 可编辑账号框、历史账号下拉、头像和当前选中标识                       |

## 调用关系

认证通过 `src/services/auth/` 与主进程认证服务处理。
注册裁剪复用 [AvatarCropEditor](../../components/avatar-crop/README.md)，桌面使用 [头像裁剪窗口](../avatar-crop/README.md)。
成功进入 [工作台](../workspace/README.md) 前仍须完成真实授权，扫码占位不代表已接入扫码登录。
