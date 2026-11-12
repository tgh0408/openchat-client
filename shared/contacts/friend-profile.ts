import type { FriendDetail } from './friend';
import { requestFriendDetail } from './friend';
import type { ApiClient } from '../api/api-client';
import { IdTypeEnum, parseContactProfile } from '../auth/auth';
import { resolveAddFriendRelationship } from './add-friend';
import type { FriendApplicationSubmission } from './friend-application';
import type { FriendRemarkSettings } from './friend-remark';
import type { RtcMediaMode } from '../rtc/rtc';

/** 资料窗按真实关系切换展示，不以缺少单聊房间推断非好友。 */
export interface FriendProfileDetail extends FriendDetail {
  relationship: 'self' | 'friend' | 'stranger';
  groupNickname: string | null;
}

/** 先核对来源房间权限，再确认关系；仅群成员补读群昵称，失败不降级为非好友。 */
export const requestFriendProfile = async (
  api: ApiClient,
  uid: string,
  roomId: string,
  groupMember: boolean = false,
): Promise<FriendProfileDetail> => {
  const detail = await requestFriendDetail(api, uid, roomId);
  if (uid === api.userId)
    return { ...detail, relationship: 'self', groupNickname: null };
  if (detail.roomId)
    return { ...detail, relationship: 'friend', groupNickname: null };
  const result = await resolveAddFriendRelationship(
    api,
    { ...detail, addFunction: null },
    roomId,
  );
  if (result.relationship === 'friend' && result.friend)
    return {
      ...result.friend,
      relationship: 'friend',
      groupNickname: null,
    };
  if (!groupMember)
    return {
      ...detail,
      relationship: result.relationship,
      groupNickname: null,
    };
  const profile = await api.request({
    path: '/capi/user/target/info',
    method: 'POST',
    body: { code: IdTypeEnum.ID, searchText: uid, roomId },
    serviceName: '群成员资料',
    parse: (value: unknown) => parseContactProfile(value, uid, roomId),
  });
  return {
    ...detail,
    relationship: result.relationship,
    groupNickname: profile.groupNickname,
  };
};

/** 主页面头像在视口内的位置，不接收任意屏幕坐标。 */
export interface FriendProfileAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 资料窗口只读取主进程绑定的会话摘要和好友详情。 */
export interface FriendProfileContext {
  uid: string;
  title: string;
  avatar: string | null;
  /** 来源是否为群成员，由主进程按绑定会话确定。 */
  groupMember?: boolean;
}

export interface FriendProfileApi {
  context: () => Promise<FriendProfileContext>;
  deleteFriend: (clearHistory: boolean) => Promise<void>;
  read: () => Promise<FriendProfileDetail>;
  openApplication: () => Promise<FriendApplicationSubmission | null>;
  openRemark: () => Promise<FriendRemarkSettings | null>;
  setBlacklisted: (blocked: boolean) => Promise<void>;
  message: () => Promise<void>;
  requestCall: (mediaMode: RtcMediaMode) => Promise<void>;
  close: () => Promise<void>;
}

/** 资料窗通话目标由主进程固定，交回工作台复用现有发起流程。 */
export interface FriendProfileRtcCallRequest {
  uid: string;
  roomId: string;
  mediaMode: RtcMediaMode;
}

/** 拒绝无效或越界的头像位置，缩放换算由主进程完成。 */
export const parseFriendProfileAnchor = (
  value: unknown,
): FriendProfileAnchor => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('头像位置无效');
  const { x, y, width, height } = value as Record<string, unknown>;
  for (const item of [x, y, width, height]) {
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0)
      throw new Error('头像位置无效');
  }
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    width < 1 ||
    height < 1 ||
    Math.max(x, y, width, height) > 100000
  )
    throw new Error('头像位置无效');
  return { x, y, width, height };
};

/** 优先靠头像右侧展开，空间不足时翻到左侧，只限制在显示器工作区。 */
export const positionFriendProfile = (
  anchor: FriendProfileAnchor,
  area: FriendProfileAnchor,
  compact: boolean = false,
): FriendProfileAnchor => {
  const width = Math.min(336, area.width);
  const height = Math.min(compact ? 262 : 516, area.height);
  const right = anchor.x + anchor.width + 8;
  const x = right + width <= area.x + area.width ? right : anchor.x - width - 8;
  return {
    x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(
      Math.max(area.y, Math.min(anchor.y, area.y + area.height - height)),
    ),
    width,
    height,
  };
};
