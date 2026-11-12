export const VIDEO_FORMATS = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  webm: 'video/webm',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
} as const;

export type VideoExtension = keyof typeof VIDEO_FORMATS;
export const VIDEO_EXTENSIONS = Object.keys(VIDEO_FORMATS);
export const VIDEO_FORMAT_LABEL =
  'MP4、MKV、AVI、MOV、WMV、FLV、WebM、MPG/MPEG';

/** 从受控文件名取得白名单格式，不接受路径、查询参数或未知扩展名。 */
export const videoExtension = (fileName: string): VideoExtension => {
  const dot = fileName.lastIndexOf('.');
  const extension = fileName.slice(dot + 1).toLowerCase();
  if (
    dot <= 0 ||
    /[/\\\u0000-\u001f?#]/.test(fileName) ||
    !Object.prototype.hasOwnProperty.call(VIDEO_FORMATS, extension)
  )
    throw new Error(`请选择 ${VIDEO_FORMAT_LABEL} 视频`);
  return extension as VideoExtension;
};

/** 校验容器签名；完整流及编解码信息由本地 FFprobe 另行验证。 */
export const checkVideoHeader = (
  bytes: Uint8Array,
  extension: VideoExtension,
): void => {
  /** 比较有界文件头，避免将整个视频读入内存。 */
  const matches = (offset: number, signature: readonly number[]): boolean =>
    signature.every((value, index) => bytes[offset + index] === value);
  const iso = matches(4, [102, 116, 121, 112]);
  const valid =
    bytes.length >= 12 &&
    (extension === 'mp4'
      ? iso
      : extension === 'mov'
        ? iso ||
          ['moov', 'mdat', 'wide', 'free'].some((box) =>
            matches(
              4,
              [...box].map((letter) => letter.charCodeAt(0)),
            ),
          )
        : extension === 'mkv' || extension === 'webm'
          ? matches(0, [0x1a, 0x45, 0xdf, 0xa3])
          : extension === 'avi'
            ? matches(0, [82, 73, 70, 70]) && matches(8, [65, 86, 73, 32])
            : extension === 'wmv'
              ? matches(
                  0,
                  [
                    0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9,
                    0, 0xaa, 0, 0x62, 0xce, 0x6c,
                  ],
                )
              : extension === 'flv'
                ? matches(0, [70, 76, 86, 1]) && (bytes[4]! & 1) === 1
                : matches(0, [0, 0, 1, 0xba]) || matches(0, [0, 0, 1, 0xb3]));
  if (!valid) throw new Error('视频内容与文件格式不匹配或文件已损坏');
};
