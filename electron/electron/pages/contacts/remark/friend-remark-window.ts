import { BrowserWindow, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent, NativeImage } from 'electron';
import path from 'node:path';
import type {
  FriendRemarkContext,
  FriendRemarkDraft,
  FriendRemarkSettings,
} from '../../../../shared/contacts/friend-remark';
import {
  parseFriendRemarkDraft,
  parseFriendRemarkSettings,
} from '../../../../shared/contacts/friend-remark';

interface RemarkEntry {
  window: BrowserWindow;
  parent: BrowserWindow;
  url: string;
  context: FriendRemarkContext;
  validate: () => void;
  dispose: () => void;
  closed: Promise<FriendRemarkSettings | null>;
  finish: (result: FriendRemarkSettings | null) => void;
  saved: FriendRemarkSettings | null;
  busy: boolean;
}

/** 管理绑定原好友和原授权的文本备注窗口。 */
export const createFriendRemarkController = (
  getRendererUrl: () => string,
  getDefaultIcon: () => NativeImage,
  operations: {
    submit: (
      context: FriendRemarkContext,
      draft: FriendRemarkDraft,
      validate: () => void,
    ) => Promise<FriendRemarkSettings>;
  },
): {
  openAndWait: (
    parent: BrowserWindow,
    context: FriendRemarkContext,
    validate: () => void,
  ) => Promise<FriendRemarkSettings | null>;
  close: () => void;
} => {
  let current: RemarkEntry | undefined;

  /** 先撤销上下文，再销毁窗口并释放父窗口监听。 */
  const close = (): void => {
    const entry = current;
    if (!entry) return;
    current = undefined;
    entry.dispose();
    if (!entry.window.isDestroyed()) entry.window.destroy();
    entry.finish(entry.saved);
  };

  /** 所有子窗口操作均核对主框架、来源和创建时的授权。 */
  const validateSender = (event: IpcMainInvokeEvent): RemarkEntry => {
    const entry = current;
    if (
      !entry ||
      entry.window.isDestroyed() ||
      event.sender !== entry.window.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== entry.url
    )
      throw new Error('备注窗口已关闭');
    try {
      entry.validate();
    } catch (cause) {
      close();
      throw cause;
    }
    return entry;
  };

  ipcMain.handle('friend-remark:read', (event): FriendRemarkContext => {
    return { ...validateSender(event).context };
  });
  ipcMain.handle('friend-remark:close', (event): void => {
    if (validateSender(event).busy) throw new Error('请等待当前操作完成');
    close();
  });
  ipcMain.handle(
    'friend-remark:submit',
    async (event, value: unknown): Promise<FriendRemarkSettings> => {
      const entry = validateSender(event);
      if (entry.busy || entry.saved)
        throw new Error('正在保存或已经保存，请勿重复提交');
      const draft = parseFriendRemarkDraft(value);
      entry.busy = true;
      /** 保存请求、响应和本地更新均绑定发起窗口与原授权。 */
      const validate = (): void => {
        if (validateSender(event) !== entry) throw new Error('备注窗口已变化');
      };
      try {
        const result = await operations.submit(entry.context, draft, validate);
        validate();
        entry.saved = parseFriendRemarkSettings(result);
        return entry.saved;
      } finally {
        entry.busy = false;
      }
    },
  );

  /** 同一好友重复打开聚焦原窗口；取消后返回原资料页。 */
  const openAndWait = async (
    parent: BrowserWindow,
    context: FriendRemarkContext,
    validate: () => void,
  ): Promise<FriendRemarkSettings | null> => {
    validate();
    const settings = parseFriendRemarkSettings(context.settings);
    if (current) {
      if (
        current.parent !== parent ||
        current.context.uid !== context.uid ||
        current.context.roomId !== context.roomId
      )
        throw new Error('请先关闭当前备注窗口');
      current.validate();
      if (!current.window.webContents.isLoading()) {
        current.window.show();
        current.window.focus();
      }
      return current.closed;
    }
    const bounds = parent.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(360, area.width);
    const height = Math.min(640, area.height);
    const window = new BrowserWindow({
      parent,
      modal: true,
      width,
      height,
      x: Math.max(
        area.x,
        Math.min(
          bounds.x + Math.round((bounds.width - width) / 2),
          area.x + area.width - width,
        ),
      ),
      y: Math.max(
        area.y,
        Math.min(
          bounds.y + Math.round((bounds.height - height) / 2),
          area.y + area.height - height,
        ),
      ),
      useContentSize: true,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      autoHideMenuBar: true,
      title: '设置备注和标签',
      icon: getDefaultIcon(),
      webPreferences: {
        preload: path.join(__dirname, 'friend-remark-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const url = new URL(getRendererUrl());
    url.hash = 'friend-remark';
    /** 旧窗口事件不能销毁之后打开的新窗口。 */
    const dismiss = (): void => {
      if (current === entry) close();
    };
    let finish: (result: FriendRemarkSettings | null) => void = (): void => {};
    const closed = new Promise<FriendRemarkSettings | null>((resolve) => {
      finish = resolve;
    });
    const entry: RemarkEntry = {
      window,
      parent,
      url: url.href,
      context: { ...context, settings },
      busy: false,
      saved: null,
      validate,
      closed,
      finish,
      /** 父页面销毁、重载和崩溃后不保留私有备注草稿。 */
      dispose: (): void => {
        parent.removeListener('closed', dismiss);
        parent.webContents.removeListener('did-start-navigation', dismiss);
        parent.webContents.removeListener('render-process-gone', dismiss);
      },
    };
    current = entry;
    parent.on('closed', dismiss);
    parent.webContents.on('did-start-navigation', dismiss);
    parent.webContents.on('render-process-gone', dismiss);
    window.on('closed', dismiss);
    window.on('close', (event) => {
      if (entry.busy) event.preventDefault();
    });
    window.webContents.on('render-process-gone', dismiss);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    try {
      await window.loadURL(entry.url);
      if (current !== entry || window.isDestroyed()) return null;
      validate();
      window.show();
      window.focus();
      return await closed;
    } catch (cause) {
      dismiss();
      throw cause;
    }
  };

  return { openAndWait, close };
};
