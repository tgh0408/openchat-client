import type { MessagePage } from '../../../shared/chat/chat';
import { toHistoryMessage } from '../../../shared/chat/chat';
import type {
  Message,
  MessagePosition,
  MessageSyncState,
} from '../../../shared/storage/database';
import {
  getHistoryContext,
  getMessageSyncState,
  saveMessageSyncPage,
  setLocalHistoryOnly,
  isGroupRemoved,
} from '../database/database';
import { parseMessage } from '../database/database-validation';

/** 同步策略的运行期状态与操作；页面不能提交或修改服务端游标。 */
export interface MessageHistorySynchronizer {
  sync: (
    roomId: string,
    mode: 'latest' | 'older',
    validate: () => void,
  ) => Promise<void>;
  invalidate: (roomId?: string) => void;
  forget: (roomId: string) => void;
}

interface RoomSync {
  epoch: number;
  revision: number;
  syncedRevision: number;
  running: Promise<void> | null;
  mode: 'latest' | 'older';
  olderCursors: Set<string>;
}

/** 比较本地分页位置，时间相同时与 SQLite 的二进制 ID 排序保持一致。 */
const earlierPosition = (
  left: MessagePosition | null,
  right: MessagePosition,
): MessagePosition =>
  !left ||
  right.createdAt < left.createdAt ||
  (right.createdAt === left.createdAt && right.id < left.id)
    ? right
    : left;

/** 找到服务端页的最早边界，未展示的消息类型也参与同步进度。 */
const pageFloor = (
  page: MessagePage,
  previous: MessagePosition | null,
): MessagePosition | null => {
  let oldest = previous;
  for (const item of page.list) {
    oldest = earlierPosition(oldest, {
      id: item.message.id,
      createdAt: new Date(item.message.sendTime).toISOString(),
    });
  }
  return oldest;
};

/** 转换并校验整页消息；表情地址无效时保留占位，结构错误仍阻止进度推进。 */
const pageMessages = (page: MessagePage): Message[] => {
  const messages: Message[] = [];
  for (const item of page.list) {
    const message = toHistoryMessage(item);
    if (message) messages.push(parseMessage(message));
  }
  return messages;
};

/** 为一次授权创建按会话串行的同步器，持久进度与本次连接代次相互独立。 */
export const createMessageHistorySynchronizer = (
  requestPage: (roomId: string, cursor: string | null) => Promise<MessagePage>,
  refreshTemporary?: (roomId: string, validate: () => void) => Promise<void>,
): MessageHistorySynchronizer => {
  const rooms = new Map<string, RoomSync>();
  let epoch = 0;

  /** 从最新页补到上次已确认的边界；中途失败不会把孤立新消息当成连续区间。 */
  const syncLatest = async (
    roomId: string,
    validate: () => void,
  ): Promise<void> => {
    const previous = getMessageSyncState(roomId);
    const cursors = new Set<string>();
    let cursor: string | null = null;
    let latestId: string | null = null;
    let oldest: MessagePosition | null = previous?.oldest ?? null;
    do {
      validate();
      const page = await requestPage(roomId, cursor);
      validate();
      getHistoryContext(roomId);
      latestId ??= page.list[0]?.message.id ?? null;
      oldest = pageFloor(page, oldest);
      const joined =
        previous?.latestId != null &&
        page.list.some((item) => item.message.id === previous.latestId);
      const complete = !previous?.latestId || joined || page.isLast;
      const state: MessageSyncState | null = complete
        ? {
            conversationId: roomId,
            latestId: latestId ?? previous?.latestId ?? null,
            olderCursor:
              previous && joined ? previous.olderCursor : page.cursor,
            oldest,
            exhausted: page.isLast || (joined && previous?.exhausted),
          }
        : null;
      if (
        !complete &&
        (!page.cursor || cursors.has(page.cursor) || page.cursor === cursor)
      )
        throw new Error('聊天记录服务返回重复或空的分页游标');
      saveMessageSyncPage(pageMessages(page), state);
      if (complete) return;
      cursor = page.cursor;
      cursors.add(cursor!);
    } while (true);
  };

  /** 只扩展已确认区间的历史尾部，推进游标和消息保存使用同一事务。 */
  const syncOlder = async (
    roomId: string,
    room: RoomSync,
    validate: () => void,
  ): Promise<void> => {
    const previous = getMessageSyncState(roomId);
    if (!previous || previous.exhausted) return;
    if (!previous.olderCursor)
      throw new Error('历史同步游标缺失，请重新同步会话');
    const page = await requestPage(roomId, previous.olderCursor);
    validate();
    getHistoryContext(roomId);
    if (
      !page.isLast &&
      (!page.cursor ||
        page.cursor === previous.olderCursor ||
        room.olderCursors.has(page.cursor))
    )
      throw new Error('聊天记录服务返回重复或空的分页游标');
    saveMessageSyncPage(pageMessages(page), {
      ...previous,
      olderCursor: page.cursor,
      oldest: pageFloor(page, previous.oldest),
      exhausted: page.isLast,
    });
    room.olderCursors.add(previous.olderCursor);
  };

  /** 每次进入重新对账最新历史；同会话在途的同类请求合并，旧历史仍沿用游标。 */
  const sync = async (
    roomId: string,
    mode: 'latest' | 'older',
    validate: () => void,
  ): Promise<void> => {
    validate();
    getHistoryContext(roomId);
    if (isGroupRemoved(roomId)) {
      rooms.delete(roomId);
      return;
    }
    let room = rooms.get(roomId);
    if (!room) {
      room = {
        epoch: -1,
        revision: 0,
        syncedRevision: 0,
        running: null,
        mode,
        olderCursors: new Set(),
      };
      rooms.set(roomId, room);
    }
    const current = room;
    /** 删除会话、退出或切换页面后，旧同步任务不得推进进度。 */
    const validateCurrent = (): void => {
      validate();
      if (rooms.get(roomId) !== current)
        throw new Error('会话已删除或重新创建');
      if (isGroupRemoved(roomId))
        throw new Error('已退出群聊，仅可读取本地消息');
    };
    if (current.running) {
      const runningMode = current.mode;
      await current.running;
      validateCurrent();
      if (
        current.epoch === epoch &&
        current.syncedRevision === current.revision &&
        mode === runningMode
      )
        return;
      return sync(roomId, mode, validate);
    }
    if (mode === 'latest') current.revision++;
    /** 补齐最新缺口后才允许继续旧历史，重连发生在请求中时重新确认边界。 */
    const run = async (): Promise<void> => {
      while (
        current.epoch !== epoch ||
        current.syncedRevision !== current.revision
      ) {
        const targetEpoch = epoch;
        const targetRevision = current.revision;
        await syncLatest(roomId, validateCurrent);
        await refreshTemporary?.(roomId, validateCurrent);
        validateCurrent();
        current.epoch = targetEpoch;
        current.syncedRevision = targetRevision;
      }
      if (mode === 'older') await syncOlder(roomId, current, validateCurrent);
    };
    current.mode = mode;
    const running = run();
    current.running = running;
    try {
      await running;
      validateCurrent();
      setLocalHistoryOnly(roomId, false);
    } catch (error) {
      // 仍需有效本地授权；失败不表示远端已读完，重新入群后从原游标合并。
      validateCurrent();
      current.epoch = -1;
      setLocalHistoryOnly(roomId, true);
      throw error;
    } finally {
      if (current.running === running) current.running = null;
    }
  };

  /** 重连使全部会话失效；订阅提示只使对应会话失效，在途请求完成后仍须补查。 */
  const invalidate = (roomId?: string): void => {
    if (roomId !== undefined) {
      const room = rooms.get(roomId);
      if (room) room.revision++;
      return;
    }
    epoch++;
  };

  /** 删除会话时丢弃内存进度并使尚未返回的请求失效。 */
  const forget = (roomId: string): void => {
    rooms.delete(roomId);
  };

  return { sync, invalidate, forget };
};
