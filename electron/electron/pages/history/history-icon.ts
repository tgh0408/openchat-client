/** 在历史窗口的隔离上下文绘制首字 PNG，不访问页面状态或加载外部资源。 */
const drawGroupIcon = (title: string): string => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法绘制群聊图标');
  const segments = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
  const first = segments.segment(title.trim())[Symbol.iterator]().next();
  const initial = first.value?.segment ?? '群';
  context.fillStyle = '#dcece5';
  context.fillRect(0, 0, 128, 128);
  context.fillStyle = '#287354';
  context.font = '600 76px "Microsoft YaHei", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(initial, 64, 64, 104);
  return canvas.toDataURL('image/png');
};

/** 只序列化固定绘图方法和 JSON 参数，群名称不能成为可执行代码。 */
export const createHistoryGroupIconScript = (title: string): string =>
  `(${drawGroupIcon.toString()})(${JSON.stringify(title)})`;
