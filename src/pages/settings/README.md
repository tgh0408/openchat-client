# 设置窗口

## 位置与职责

- 源码位置：`src/pages/settings/`。
- 界面位置：工作台左下角更多菜单打开的独立设置窗口。
- 加载入口：`#settings`。

## 文件说明

| 文件                                     | 功能                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| [SettingsWindow.vue](SettingsWindow.vue) | 设置分类布局、版本检查、日志等级读取和修改、当前账号资料及退出登录确认 |

## 调用关系

由 [ChatWorkspace.vue](../workspace/ChatWorkspace.vue) 打开，
通过 `window.settingsDesktop` 与 `electron/pages/settings/` 协作。
发现新版本后进入 [更新窗口](../update/README.md)，退出登录沿用主进程统一清理。
界面中未绑定真实处理的设置展示项不代表功能已接入；登录前的设置属于 [login](../login/README.md)。
