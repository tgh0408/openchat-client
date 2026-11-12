/** 单成员入群提示快照；正文用于搜索摘要，昵称字段用于安全高亮。 */
export interface GroupInvitationMessage {
  kind: 'group-invitation';
  inviterName: string;
  memberName: string;
  content: string;
}

/** 单成员移出提示快照；memberUid 用于当前用户视角转换。 */
export interface GroupRemovalMessage {
  kind: 'group-removal';
  operatorName: string;
  memberUid: string;
  memberName: string;
  content: string;
}

/** 校验公开昵称，不把模板文字、HTML 或分隔符当作昵称边界。 */
const isName = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 1024 &&
  !value.includes('\0');

/** 从结构化字段恢复单成员提示，正文必须与快照一致。 */
const readInvitation = (value: unknown): GroupInvitationMessage | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    data.kind !== 'group-invitation' ||
    !isName(data.inviterName) ||
    !isName(data.memberName)
  )
    return null;
  const content = `${data.inviterName} 邀请 ${data.memberName} 进入了群聊`;
  if (data.content !== content) return null;
  return {
    kind: 'group-invitation',
    inviterName: data.inviterName,
    memberName: data.memberName,
    content,
  };
};

/** 从结构化字段恢复单成员移出提示。 */
const readRemoval = (value: unknown): GroupRemovalMessage | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    data.kind !== 'group-removal' ||
    !isName(data.operatorName) ||
    !isName(data.memberName) ||
    typeof data.memberUid !== 'string' ||
    !/^[1-9]\d{0,18}$/.test(data.memberUid) ||
    (data.memberUid.length === 19 && data.memberUid > '9223372036854775807')
  )
    return null;
  const content = `${data.memberName} 被 ${data.operatorName} 移出群聊`;
  if (data.content !== content) return null;
  return {
    kind: 'group-removal',
    operatorName: data.operatorName,
    memberUid: data.memberUid,
    memberName: data.memberName,
    content,
  };
};

/** 读取本地系统提示；普通纯文本系统消息不带昵称高亮。 */
export const parseGroupInvitationMessage = (
  content: string,
): GroupInvitationMessage | null => {
  if (content.length > 65536) return null;
  try {
    return readInvitation(JSON.parse(content));
  } catch {
    return null;
  }
};

/** 读取本地移出提示。 */
export const parseGroupRemovalMessage = (
  content: string,
): GroupRemovalMessage | null => {
  if (content.length > 65536) return null;
  try {
    return readRemoval(JSON.parse(content));
  } catch {
    return null;
  }
};

/** 摘要和搜索读取纯文本，不展示持久化 JSON。 */
export const systemMessageText = (content: string, userId?: string): string => {
  const removal = parseGroupRemovalMessage(content);
  if (removal)
    return removal.memberUid === userId
      ? `你被 ${removal.operatorName} 移出群聊`
      : removal.content;
  return parseGroupInvitationMessage(content)?.content ?? content;
};

/** SSE 与历史统一保存昵称快照；无结构化扩展的系统消息保持纯文本。 */
export const encodeReceivedSystemMessage = (
  body: Record<string, unknown>,
): string => {
  if (
    typeof body.content !== 'string' ||
    !body.content.trim() ||
    body.content.length > 65536 ||
    body.content.includes('\0')
  )
    throw new Error('系统提示正文无效');
  if (body.extra == null) return body.content;
  if (typeof body.extra !== 'object' || Array.isArray(body.extra))
    throw new Error('系统提示昵称快照无效');
  const invitation = readInvitation({ ...body.extra, content: body.content });
  if (invitation) return JSON.stringify(invitation);
  const removal = readRemoval({ ...body.extra, content: body.content });
  if (removal) return JSON.stringify(removal);
  throw new Error('系统提示昵称快照无效');
};
