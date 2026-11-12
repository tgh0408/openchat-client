import type { AddFriendSearchResult } from '../contacts/add-friend';
import type { RtcMediaMode } from '../rtc/rtc';
import type { FriendRemarkSettings } from '../contacts/friend-remark';

/** 添加朋友窗口专属的受控桌面桥接。 */
export interface AddFriendWindowApi {
  search: (query: string) => Promise<AddFriendSearchResult>;
  openChat: () => Promise<void>;
  requestCall: (mediaMode: RtcMediaMode) => Promise<void>;
  openRemark: () => Promise<FriendRemarkSettings | null>;
  setBlacklisted: (blocked: boolean) => Promise<void>;
  deleteFriend: (clearHistory: boolean) => Promise<void>;
  openApplication: (targetUid: string) => Promise<AddFriendSearchResult | null>;
  close: () => Promise<void>;
}
