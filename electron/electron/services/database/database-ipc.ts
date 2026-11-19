import { handleChatIpc } from '../ipc/chat-ipc';
import type { IpcMainInvokeEvent } from 'electron';
import {
  clearConversation,
  confirmSentMessage,
  deleteConversation,
  deleteStoredFile,
  getLocalSettings,
  listConversations,
  listMessages,
  listUnconfirmedMessages,
  readOutgoingMessage,
  readRecalledMessageText,
  readMessageReply,
  listStoredFiles,
  saveConversation,
  saveLocalSettings,
  saveMessage,
  saveIncomingMessage,
  searchMessages,
  readCachedMessagePage,
  readCachedMessageBatch,
} from './database';
import {
  parseBoolean,
  parseInteger,
  parseMessage,
  parseObject,
  parseText,
  parseHistoryQuery,
  parseMessagePosition,
  parseMessageBatchIds,
} from './database-validation';

/** 注册有白名单和运行时校验的数据库接口，不允许页面直接执行 SQL。 */
export const registerDatabaseIpc = (
  validateSender: (event: IpcMainInvokeEvent) => void,
  afterConversationDelete: (
    id: string,
    localPaths: string[],
  ) => Promise<void> | void,
  isReadOnly: () => boolean,
  afterIncomingMessage: (
    roomId: string,
    unreadCount: number,
    newMessage: boolean,
  ) => void,
): void => {
  handleChatIpc(
    'database:read-message-reply',
    (event, roomId: unknown, messageId: unknown) => {
      validateSender(event);
      return readMessageReply(parseText(roomId, 64), parseText(messageId, 64));
    },
  );
  handleChatIpc(
    'database:read-recalled-message-text',
    (event, roomId: unknown, messageId: unknown) => {
      validateSender(event);
      return readRecalledMessageText(
        parseText(roomId, 64),
        parseText(messageId, 64),
      );
    },
  );
  handleChatIpc(
    'database:list-unconfirmed-messages',
    (event, after: unknown) => {
      validateSender(event);
      return listUnconfirmedMessages(parseMessagePosition(after));
    },
  );
  handleChatIpc(
    'database:read-outgoing-message',
    (event, roomId: unknown, clientMsgId: unknown) => {
      validateSender(event);
      return readOutgoingMessage(
        parseText(roomId, 64),
        parseText(clientMsgId, 64),
      );
    },
  );
  handleChatIpc(
    'database:read-message-page',
    (event, id: unknown, before: unknown) => {
      validateSender(event);
      return readCachedMessagePage(
        parseText(id),
        parseMessagePosition(before),
        isReadOnly(),
      );
    },
  );
  handleChatIpc(
    'database:read-message-batch',
    (event, roomId: unknown, ids: unknown) => {
      validateSender(event);
      return readCachedMessageBatch(
        parseText(roomId, 64),
        parseMessageBatchIds(ids),
      );
    },
  );
  handleChatIpc('database:search-messages', (event, value: unknown) => {
    validateSender(event);
    return searchMessages(parseHistoryQuery(value));
  });
  handleChatIpc('database:get-settings', (event) => {
    validateSender(event);
    return getLocalSettings();
  });
  handleChatIpc('database:save-settings', (event, value: unknown) => {
    validateSender(event);
    saveLocalSettings(parseBoolean(value));
  });
  handleChatIpc(
    'database:list-files',
    (event, limit: unknown = 100, offset: unknown = 0) => {
      validateSender(event);
      return listStoredFiles(
        parseInteger(limit, 1, 200),
        parseInteger(offset, 0, 10_000_000),
      );
    },
  );
  handleChatIpc('database:delete-file', (event, id: unknown) => {
    validateSender(event);
    deleteStoredFile(parseInteger(id, 1, Number.MAX_SAFE_INTEGER));
  });
  handleChatIpc('database:save-conversation', (event, value: unknown) => {
    validateSender(event);
    const data = parseObject(value, ['id', 'title', 'participantId']);
    return saveConversation({
      id: parseText(data.id),
      title: parseText(data.title),
      participantId:
        data.participantId == null ? null : parseText(data.participantId),
    });
  });
  handleChatIpc(
    'database:list-conversations',
    (event, limit: unknown = 50, offset: unknown = 0) => {
      validateSender(event);
      return listConversations(
        parseInteger(limit, 1, 200),
        parseInteger(offset, 0, 10_000_000),
      );
    },
  );
  handleChatIpc(
    'database:delete-conversation',
    async (event, id: unknown): Promise<void> => {
      validateSender(event);
      const conversationId = parseText(id);
      deleteConversation(conversationId);
      await afterConversationDelete(conversationId, []);
    },
  );
  handleChatIpc(
    'database:clear-conversation',
    async (event, id: unknown): Promise<void> => {
      validateSender(event);
      const conversationId = parseText(id);
      const localPaths = clearConversation(conversationId);
      await afterConversationDelete(conversationId, localPaths);
    },
  );
  handleChatIpc('database:save-message', (event, value: unknown) => {
    validateSender(event);
    return saveMessage(parseMessage(value));
  });
  handleChatIpc(
    'database:save-incoming-message',
    (event, value: unknown, incrementUnread: unknown) => {
      validateSender(event);
      const message = parseMessage(value);
      const { newUnreadMessage, ...result } = saveIncomingMessage(
        message,
        parseBoolean(incrementUnread),
      );
      afterIncomingMessage(
        message.conversationId,
        result.unreadCount,
        newUnreadMessage,
      );
      return result;
    },
  );
  handleChatIpc(
    'database:confirm-message',
    (event, clientMsgId: unknown, serverId: unknown) => {
      validateSender(event);
      confirmSentMessage(parseText(clientMsgId, 64), parseText(serverId, 64));
    },
  );
  handleChatIpc(
    'database:list-messages',
    (event, id: unknown, limit: unknown = 50, offset: unknown = 0) => {
      validateSender(event);
      return listMessages(
        parseText(id),
        parseInteger(limit, 1, 200),
        parseInteger(offset, 0, 10_000_000),
      );
    },
  );
};
