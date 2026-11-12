import type { Conversation } from '../storage/database';
import type { GroupDirectoryItem } from '../contacts/group';

/** 托盘仅展示当前账号的未读会话，不传递消息正文或登录凭据。 */
export type TrayConversation = Pick<
  Conversation,
  'id' | 'title' | 'avatar' | 'type' | 'unreadCount' | 'updatedAt'
> & {
  group?: Pick<GroupDirectoryItem, 'memberCount' | 'avatarList'>;
};

export interface TrayPreviewApi {
  read: () => Promise<TrayConversation[]>;
  ready: () => Promise<void>;
  open: (roomId: string) => Promise<void>;
  ignore: () => Promise<void>;
  hide: () => Promise<void>;
  onChanged: (callback: (items: TrayConversation[]) => void) => () => void;
}
