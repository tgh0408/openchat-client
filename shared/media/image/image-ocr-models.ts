/** 随安装包部署的 PP-OCRv6 medium 模型与完整字典，运行时不使用 SDK 在线默认值。 */
export const IMAGE_OCR_MODEL_FILES = {
  detection: 'PP-OCRv6_medium_det.onnx',
  recognition: 'PP-OCRv6_medium_rec.onnx',
  charactersDictionary: 'ppocrv6_dict.txt',
} as const;

/** 本地资源文件清单，许可证同样是启用识别的必要文件。 */
export const IMAGE_OCR_ASSETS = [
  {
    file: IMAGE_OCR_MODEL_FILES.detection,
  },
  {
    file: IMAGE_OCR_MODEL_FILES.recognition,
  },
  {
    file: IMAGE_OCR_MODEL_FILES.charactersDictionary,
  },
  {
    file: 'LICENSE-PaddleOCR.txt',
  },
] as const;
