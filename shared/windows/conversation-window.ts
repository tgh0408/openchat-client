import type { AuthUser } from '../auth/auth';
import type { ConversationSummary } from '../storage/database';

export interface ConversationWindowContext {
  conversation: ConversationSummary;
  user: AuthUser;
}

export interface ConversationWindowApi {
  context: () => Promise<ConversationWindowContext>;
}

/** 子窗口仅能调用这些现有聊天能力，认证、账号和全局数据库操作不开放。 */
export const conversationChannels = new Set([
  'resource:get-status',
  'chat:cached-emojis',
  'chat:list-emojis',
  'chat:delete-emoji',
  'chat:front-emoji',
  'chat:add-image-emoji',
  'chat:image-emoji-status',
  'chat:list-groups',
  'chat:list-group-members',
  'chat:update-group-info',
  'chat:refresh-conversation',
  'chat:read-conversation',
  'chat:set-conversation-top',
  'chat:send-message',
  'chat:delete-message',
  'chat:sync-history',
  'chat:choose-images',
  'chat:capture-screenshot',
  'chat:stage-dropped-media',
  'chat:stage-clipboard-images',
  'chat:upload-image-draft',
  'chat:release-image-drafts',
  'database:read-message-page',
  'database:read-message-batch',
  'database:list-messages',
  'database:save-message',
  'database:read-outgoing-message',
  'database:read-recalled-message-text',
  'database:read-message-reply',
  'database:search-messages',
  'contact:get-profile',
  'voice:upload',
  'voice:read',
  'image:read-message',
  'image:read-local-message',
  'image:show-in-folder',
  'message:copy-attachment',
  'image-preview:open',
  'image-preview:open-draft',
  'history:open',
  'friend-profile:open',
  'chat:apply-conversation-friend',
  'friend-profile:dismiss',
  'file:choose',
  'file:prepare-draft',
  'file:release',
  'file:restore',
  'file:send',
  'file:cancel',
  'file:status',
  'file:download',
  'file:show-in-folder',
  'file:save-as',
  'video:choose',
  'video:prepare-draft',
  'video:persist-draft',
  'video:restore-draft',
  'video:upload',
  'video:release',
  'video:stop',
  'video:create-placeholder',
  'video:complete-placeholder',
  'video:cancel-placeholder',
  'video:status',
  'video:poster',
  'video:read-upload',
  'video:show-in-folder',
  'video:download',
  'video:open',
]);

/** 按已知协议提取会话边界；无会话参数的账号表情和连接状态单独放行。 */
export const conversationChannelRoom = (
  channel: string,
  args: unknown[],
): unknown => {
  const value = args[0];
  switch (channel) {
    case 'resource:get-status':
    case 'chat:cached-emojis':
    case 'chat:list-emojis':
    case 'chat:delete-emoji':
    case 'chat:front-emoji':
    case 'chat:list-groups':
    case 'friend-profile:dismiss':
      return null;
    case 'contact:get-profile':
      return args[2];
    case 'chat:list-group-members':
    case 'chat:update-group-info':
    case 'friend-profile:open':
      return channel === 'chat:update-group-info' &&
        value &&
        typeof value === 'object' &&
        'roomId' in value
        ? value.roomId
        : args[0];
    case 'chat:send-message':
      return value && typeof value === 'object' && 'roomId' in value
        ? value.roomId
        : undefined;
    case 'database:save-message':
    case 'database:search-messages':
    case 'voice:read':
    case 'image:read-message':
    case 'image:read-local-message':
    case 'image:show-in-folder':
    case 'message:copy-attachment':
    case 'chat:add-image-emoji':
    case 'chat:delete-message':
    case 'chat:image-emoji-status':
    case 'image-preview:open':
    case 'file:restore':
    case 'file:status':
    case 'file:download':
    case 'file:show-in-folder':
    case 'file:save-as':
    case 'video:restore-draft':
    case 'video:status':
    case 'video:poster':
    case 'video:read-upload':
    case 'video:show-in-folder':
    case 'video:download':
    case 'video:open':
      return value && typeof value === 'object' && 'conversationId' in value
        ? value.conversationId
        : undefined;
    default:
      return value;
  }
};
