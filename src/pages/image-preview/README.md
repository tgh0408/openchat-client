# 图片预览与文字识别

## 位置与职责

- 源码位置：`src/pages/image-preview/`。
- 界面位置：聊天图片、历史图片或图片草稿打开的独立预览窗口。
- 加载入口：`#image-preview`。

## 文件说明

| 文件                                             | 功能                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| [ImagePreviewWindow.vue](ImagePreviewWindow.vue) | 图片加载、缩放、平移、旋转、适应窗口、全屏、相邻图片导航和 OCR 区域编排 |
| [ImageOcrLayer.vue](ImageOcrLayer.vue)           | 覆盖在图片上的可选择文字层，跟随图片变换并将选区交给编辑区              |
| [ImageOcrEditor.vue](ImageOcrEditor.vue)         | 侧边识别文本编辑、原文选区映射、复制及错误或加载状态                    |
| [useImageOcr.ts](useImageOcr.ts)                 | 识别任务、缓存协作、编辑草稿及切图或卸载后的任务清理                    |

## 调用关系

通过 `window.imagePreviewDesktop` 使用 `electron/pages/image-preview/` 的受控读取和窗口能力，
不接受任意本机路径。已保存图片的相邻导航限于当前会话缓存，草稿沿用对应预览上下文。
OCR 详细约定见 [image-ocr.md](../../../docs/image-ocr.md)。
