# 版本更新窗口

## 位置与职责

- 源码位置：`src/pages/update/`。
- 界面位置：设置检查发现新版本后的更新界面，以及执行更新前的独立确认窗口。
- 加载入口：`#update`、`#update-confirm`。

## 文件说明

| 文件                                                 | 功能                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| [UpdateWindow.vue](UpdateWindow.vue)                 | 读取绑定版本，订阅真实下载进度，发起或取消更新并展示结果            |
| [UpdateVersionDialog.vue](UpdateVersionDialog.vue)   | 展示版本、更新说明、进度和操作按钮；实际动作通过事件交给父级        |
| [UpdateConfirmWindow.vue](UpdateConfirmWindow.vue)   | 读取绑定版本并向主进程回传立即更新或暂缓的选择                      |
| [UpdateVersionPreview.vue](UpdateVersionPreview.vue) | 使用静态参考文案预览更新外观，当前未被 `src/main.ts` 的正式入口引用 |

## 调用关系

版本检查入口在 [SettingsWindow.vue](../settings/SettingsWindow.vue)。
真实窗口分别通过 `window.updateDesktop` 和 `window.updateConfirmDesktop`
调用 `electron/pages/update/` 的控制器与更新服务。
预览文案不代表检测到真实版本；当前“忽略”和“以后再说”均由父页面关闭窗口，不据此承诺持久化忽略或定时提醒。
