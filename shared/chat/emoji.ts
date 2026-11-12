import type { ApiClient } from '../api/api-client';
import { parseApiResult } from '../api/api-response';
import type { Message } from '../storage/database';

/** 当前用户收藏的图片表情，只保存服务端标识和图片地址。 */
export interface UserEmoji {
  imgId: string;
  url: string;
  sha256: string | null;
  sort: string;
}

/** 表情消息正文中的元数据，发送重试只使用标识，不提交图片地址。 */
export interface StoredEmojiContent {
  emojiId: string;
  /** 接收消息的地址无效时为空，保留消息并显示不可用占位。 */
  url: string | null;
}

/** 仅已确认的远端图片或表情可按服务端消息标识收藏。 */
export const canAddImageEmoji = (message: Message): boolean =>
  ['image', 'emoji'].includes(message.messageType) &&
  message.status === 'sent' &&
  !message.deletedAt &&
  /^[1-9]\d{0,18}$/.test(message.id) &&
  /^[1-9]\d{0,18}$/.test(message.conversationId);

/** 添加成功必须返回真实表情元数据，不能把空响应当成本地缓存记录。 */
const parseAddImageEmojiResult = (value: unknown): UserEmoji => {
  const result = parseApiResult(value, '添加表情');
  return parseUserEmoji(result.data);
};

/** 收藏已确认的图片消息，地址及图片字节由后端读取，不重新上传。 */
export const requestAddImageEmoji = async (
  api: ApiClient,
  message: Message,
): Promise<UserEmoji> => {
  if (!canAddImageEmoji(message))
    throw new Error('只能添加已发送成功的图片或表情');
  const body: Record<string, unknown> = {
    roomId: message.conversationId,
    msgId: message.id,
  };
  if (message.messageType === 'emoji') {
    const emoji = parseEmojiContent(message.content);
    if (!emoji) throw new Error('表情消息数据无效');
    body.emojiId = emoji.emojiId;
  }
  return api.request({
    path: '/capi/user/emoji',
    method: 'POST',
    body,
    serviceName: '添加表情',
    httpError: '添加到表情失败',
    parse: parseAddImageEmojiResult,
  });
};

/** 删除接口只接收正数 Long 字符串，不接受 URL 或精度丢失的数字。 */
export const parseEmojiId = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,18}$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new Error('表情包标识无效');
  return value;
};

/** 删除只认服务端明确成功，业务错误和畸形响应保留原收藏。 */
const parseDeleteEmojiResult = (value: unknown): void => {
  parseApiResult(value, '删除表情包');
};

/** 删除当前账号的收藏关系，不删除聊天记录或共享图片。 */
export const requestDeleteEmoji = async (
  api: ApiClient,
  imgId: string,
): Promise<void> => {
  await api.request({
    path: '/capi/user/emoji/delete',
    method: 'POST',
    body: { imgId: parseEmojiId(imgId) },
    serviceName: '删除表情包',
    httpError: '删除表情包失败',
    parse: parseDeleteEmojiResult,
  });
};

/** 排序值是有符号 Long 字符串，拒绝浮点数、前导零和越界值。 */
export const parseEmojiSort = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length > 20 ||
    !/^(0|-?[1-9]\d*)$/.test(value)
  )
    throw new Error('表情包排序值无效');
  const sort = BigInt(value);
  if (sort < -9223372036854775808n || sort > 9223372036854775807n)
    throw new Error('表情包排序值无效');
  return value;
};

/** 按服务端的 sort、表情 ID 升序排列，不使用浮点数处理 Long。 */
export const compareUserEmojis = (
  left: UserEmoji,
  right: UserEmoji,
): number => {
  const leftSort = BigInt(left.sort);
  const rightSort = BigInt(right.sort);
  if (leftSort < rightSort) return -1;
  if (leftSort > rightSort) return 1;
  const leftId = BigInt(left.imgId);
  const rightId = BigInt(right.imgId);
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
};

/** 移动只提交标识，排序由服务器分配；返回完整列表用于当前账号校准。 */
export const requestMoveEmojiToFront = async (
  api: ApiClient,
  value: string,
): Promise<UserEmoji[]> => {
  const imgId = parseEmojiId(value);
  const list = await api.request({
    path: '/capi/user/emoji/front',
    method: 'POST',
    body: { imgId },
    serviceName: '移动表情包',
    httpError: '移动表情包失败',
    parse: parseEmojiList,
  });
  if (list[0]?.imgId !== imgId) throw new Error('表情排序响应与请求不一致');
  return list;
};

/** 校验公开图片地址，不允许本地文件、脚本、内嵌数据或 URL 凭据。 */
export const parseEmojiUrl = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    /[\u0000-\u0020]/.test(value)
  )
    throw new Error('表情包图片地址无效');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('表情包图片地址无效');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('表情包图片地址无效');
  return url.href;
};

/** 将校验后的表情标识和 URL 编码到现有消息正文列，不保存图片二进制。 */
export const encodeEmojiContent = (emojiId: string, url: string): string => {
  if (!/^[1-9]\d{0,63}$/.test(emojiId)) throw new Error('表情包标识无效');
  return JSON.stringify({ emojiId, url: parseEmojiUrl(url) });
};

/** 接收时隔离无效图片地址，不丢弃消息或阻断历史同步；标识仍严格校验。 */
export const encodeReceivedEmojiContent = (
  emojiId: string,
  value: unknown,
): string => {
  if (!/^[1-9]\d{0,63}$/.test(emojiId)) throw new Error('表情包标识无效');
  let url: string | null = null;
  try {
    url = parseEmojiUrl(value);
  } catch {
    // 不保存不可信地址，也不根据认证服务地址猜测 OSS 域名。
  }
  return JSON.stringify({ emojiId, url });
};

/** 解码本地表情正文，损坏记录不作为图片地址或发送参数使用。 */
export const parseEmojiContent = (value: string): StoredEmojiContent | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    const data = parsed as Record<string, unknown>;
    if (
      typeof data.emojiId !== 'string' ||
      !/^[1-9]\d{0,63}$/.test(data.emojiId)
    )
      return null;
    return {
      emojiId: data.emojiId,
      url: data.url === null ? null : parseEmojiUrl(data.url),
    };
  } catch {
    return null;
  }
};

/** 只依据账号缓存匹配；图片没有本地摘要时不能猜测为未收藏。 */
export const isMessageEmojiCached = (
  message: Message,
  cache: readonly UserEmoji[],
  sha256?: string,
): boolean => {
  if (!canAddImageEmoji(message)) throw new Error('消息不可收藏');
  switch (message.messageType) {
    case 'emoji': {
      const emoji = parseEmojiContent(message.content);
      if (!emoji) throw new Error('表情消息数据无效');
      return cache.some((item) => item.imgId === emoji.emojiId);
    }
    case 'image':
      if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256))
        throw new Error('图片尚无有效的本地摘要');
      return cache.some((item) => item.sha256 === sha256);
    default:
      throw new Error('消息不可收藏');
  }
};

/** 列表和新增响应共用元数据校验；历史无摘要记录仍可按表情 ID 判断。 */
export const parseUserEmoji = (entry: unknown): UserEmoji => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry))
    throw new Error('表情包数据无效');
  const item = entry as Record<string, unknown>;
  const imgId =
    typeof item.imgId === 'number' && Number.isSafeInteger(item.imgId)
      ? String(item.imgId)
      : item.imgId;
  if (
    typeof imgId !== 'string' ||
    !/^[1-9]\d{0,63}$/.test(imgId) ||
    (item.sha256 !== null &&
      (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)))
  )
    throw new Error('表情包标识或摘要无效');
  return {
    imgId,
    url: parseEmojiUrl(item.url),
    sha256: item.sha256,
    sort: parseEmojiSort(item.sort),
  };
};

/** 校验表情列表，拒绝非法标识、重复项及非 HTTP(S) 图片地址。 */
export const parseEmojiList = (value: unknown): UserEmoji[] => {
  const root = parseApiResult(value, '表情包');
  if (!Array.isArray(root.data)) throw new Error('表情包服务返回的数据无效');
  const ids = new Set<string>();
  return root.data
    .map((entry: unknown): UserEmoji => {
      const item = parseUserEmoji(entry);
      if (ids.has(item.imgId)) throw new Error('表情包数据重复');
      ids.add(item.imgId);
      return item;
    })
    .sort(compareUserEmojis);
};

/** 携带当前账号授权和平台 clientId 获取真实表情列表。 */
export const requestEmojiList = async (
  api: ApiClient,
): Promise<UserEmoji[]> => {
  return api.request({
    path: '/capi/user/emoji/list',
    method: 'GET',
    serviceName: '表情包',
    httpError: '获取表情包失败',
    parse: parseEmojiList,
  });
};
