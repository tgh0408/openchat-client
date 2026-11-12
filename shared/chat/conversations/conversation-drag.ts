export interface ConversationDragRequest {
  id: string;
  roomId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

/** 只接受有界的会话行截取区域及鼠标热点，不接受图片、HTML 或路径。 */
export const parseConversationDrag = (
  value: unknown,
): ConversationDragRequest => {
  if (!value || typeof value !== 'object') throw new Error('无效的会话拖动');
  const data = value as Record<string, unknown>;
  if (
    typeof data.id !== 'string' ||
    !/^[a-zA-Z0-9-]{1,64}$/.test(data.id) ||
    typeof data.roomId !== 'string' ||
    !/^[1-9]\d{0,63}$/.test(data.roomId)
  )
    throw new Error('无效的会话拖动');
  for (const key of ['x', 'y', 'width', 'height', 'offsetX', 'offsetY'])
    if (
      typeof data[key] !== 'number' ||
      !Number.isFinite(data[key]) ||
      data[key] < 0 ||
      data[key] > 10000
    )
      throw new Error('无效的拖动区域');
  const request = data as unknown as ConversationDragRequest;
  if (
    request.width < 1 ||
    request.width > 600 ||
    request.height < 1 ||
    request.height > 120 ||
    request.offsetX > request.width ||
    request.offsetY > request.height
  )
    throw new Error('无效的拖动区域');
  return request;
};
