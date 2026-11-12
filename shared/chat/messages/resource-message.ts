import type { RtcCallState, RtcMediaMode } from '../../rtc/rtc';

/** 资源 SSE 推送消息的发送者信息；Long 字段由后端以字符串下发。 */
export interface ResourceChatUser {
  /** 发送者用户 id。 */
  uid: string;
}

/** 文本消息（type=1）的内容体；其余字段结构尚未约定，先以 unknown 预留。 */
export interface ResourceTextBody {
  content: string;
  extra: unknown;
  urlContentMap: unknown;
  atUidList: unknown;
  reply: unknown;
}

/** 图片表情消息的内容体。 */
export interface ResourceEmojiBody {
  content: string;
  extra: { emojiId: string; description?: string | null };
}

/** 普通图片消息正文；文件大小由 Java Long 序列化为字符串。 */
export interface ResourceImageBody {
  content: string;
  extra: { fileName: string; size: string; upLoadPath?: string } | null;
}

/** 视频与封面使用公开地址，时长毫秒和文件字节数遵守 Long 字符串协议。 */
export interface ResourceVideoBody {
  content: string;
  extra: {
    fileName: string;
    size: string;
    duration: string;
    thumbUrl: string;
    thumbSize: string;
    thumbWidth: number;
    thumbHeight: number;
  } | null;
}

/** RTC 通话摘要的原始协议；名称仅在解析入口兼容，业务使用归一化枚举。 */
export interface ResourceRtcCallBody {
  content: string;
  extra: {
    callId: string;
    mediaMode: RtcMediaMode | keyof typeof RtcMediaMode;
    state: RtcCallState | keyof typeof RtcCallState;
    endReason: string | null;
    endedByUid: string | null;
    acceptedAt: number | string | null;
    endedAt: number | string | null;
    durationSeconds: string | number;
  };
}

/** 系统提示正文；每位入群成员独立一条，昵称快照用于高亮。 */
export interface ResourceSystemBody {
  content: string;
  extra:
    | {
        kind: 'group-invitation';
        inviterName: string;
        memberName: string;
      }
    | {
        kind: 'group-removal';
        operatorName: string;
        memberUid: string;
        memberName: string;
      }
    | null;
}

/** 资源消息类型常量，与后端 ChatMessageResp.Message.type 对齐。 */
export const ResourceMessageType = {
  /** 正常文本。 */
  Text: 1,
  /** 撤回消息，body 为 { recallUid: string | null, recallName: string | null }。 */
  Recall: 2,
  /** 临时消息。 */
  Temporary: 3,
  /** 图片。 */
  Image: 4,
  /** 视频。 */
  Video: 5,
  File: 6,
  /** 录制的语音条，与音频文件 type 7 区分。 */
  Sound: 8,
  /** 图片表情。 */
  Emoji: 9,
  /** 服务端业务事件生成的系统提示，body.content 为完整纯文本。 */
  System: 10,
  /** RTC 通话终态摘要。 */
  RtcCall: 11,
} as const;

/** 资源消息详情；id、roomId 由后端以字符串下发，避免 Long 精度丢失。 */
export interface ResourceChatMessageDetail {
  id: string;
  replyId?: string | null;
  roomId: string;
  /** 消息发送时间，Unix 毫秒时间戳。 */
  sendTime: number;
  type: number;
  /** 消息内容体，结构随 type 变化；文本时为 ResourceTextBody。 */
  body: unknown;
  clientMsgId: string | null;
}

/** 资源 SSE 推送的单条聊天消息，对应后端 ChatMessageResp。 */
export interface ResourceChatMessage {
  fromUser: ResourceChatUser;
  message: ResourceChatMessageDetail;
}
