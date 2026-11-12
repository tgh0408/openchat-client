# 头像裁剪组件

## 位置与职责

- 源码位置：`src/components/avatar-crop/`。
- 界面位置：注册选图后的裁剪区域，在桌面原生窗口或浏览器注册弹窗内展示。

## 文件说明

| 文件                                         | 功能                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| [AvatarCropEditor.vue](AvatarCropEditor.vue) | 原图预览、正方形选区移动和缩放、像素边长调整、重置、键盘微调及 PNG 裁剪结果提交 |

## 调用关系

[AvatarCropWindow.vue](../../pages/avatar-crop/AvatarCropWindow.vue) 承载桌面裁剪；
[LoginPanel.vue](../../pages/login/LoginPanel.vue) 在浏览器预览中按需加载同一编辑器。
编辑器按原图选区像素导出，不负责注册请求、上传或持久化；取消由父级处理。
