# 截图共享模块

截图的操作流程、平台条件、拼接机制和资源限制统一见 [桌面截图](../../../docs/screenshot.md)。

| 文件                        | 职责                             |
| --------------------------- | -------------------------------- |
| `screenshot.ts`             | 页面协议、选区坐标校验与裁剪换算 |
| `screenshot-window-snap.ts` | 窗口候选区域与显示器坐标计算     |
| `screenshot-features.ts`    | 图像行及采样特征                 |
| `screenshot-columns.ts`     | 列采样位移候选和像素校验         |
| `screenshot-stitch.ts`      | 双向增量拼接、回滚与固定栏处理   |
| `screenshot-composite.ts`   | 分段像素保存、长图合成及预览采样 |
| `screenshot-preview.ts`     | 实时预览布局及可见范围           |

原生采集和输入位于 `electron/pages/screenshot/`，界面位于 `src/pages/screenshot/`。共享模块不直接创建窗口、监听系统输入或访问用户数据库。
