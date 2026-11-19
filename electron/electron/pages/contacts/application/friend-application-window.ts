import { BrowserWindow, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent, NativeImage } from 'electron';
import path from 'node:path';
import { parseFriendApplicationDraft } from '../../../../shared/contacts/friend-application';
import type {
  FriendApplicationContext,
  FriendApplicationDraft,
  FriendApplicationSubmission,
} from '../../../../shared/contacts/friend-application';

interface ApplicationEntry<Context extends object, Result> {
  window: BrowserWindow;
  parent: BrowserWindow;
  url: string;
  context: Context;
  validate: () => void;
  dispose: () => void;
  submitting: boolean;
  submitted: boolean;
  result: Promise<boolean>;
  finish: (submitted: boolean) => void;
  submission: Result | null;
}

/** 申请与验证共用原生表单窗口；各自绑定独立上下文、校验器及 IPC。 */
export const createFriendFormController = <
  Context extends object,
  Draft,
  Result = void,
>(
  getRendererUrl: () => string,
  getDefaultIcon: () => NativeImage,
  options: {
    channel: 'friend-application' | 'friend-verification';
    title: string;
    parse: (value: unknown) => Draft;
  },
  submit: (
    context: Context,
    draft: Draft,
    validate: () => void,
  ) => Promise<Result>,
): {
  open: (
    parent: BrowserWindow,
    context: Context,
    validate: () => void,
  ) => Promise<void>;
  openAndWait: (
    parent: BrowserWindow,
    context: Context,
    validate: () => void,
  ) => Promise<boolean>;
  openAndWaitResult: (
    parent: BrowserWindow,
    context: Context,
    validate: () => void,
  ) => Promise<Result | null>;
  close: (parent?: BrowserWindow) => void;
} => {
  let current: ApplicationEntry<Context, Result> | undefined;

  /** 先撤销上下文再销毁窗口，退出及父页面失效时不保留草稿。 */
  const close = (parent?: BrowserWindow): void => {
    const entry = current;
    if (!entry || (parent && entry.parent !== parent)) return;
    current = undefined;
    entry.dispose();
    if (!entry.window.isDestroyed()) entry.window.destroy();
    entry.finish(entry.submitted);
  };

  /** 校验子窗口、主框架、URL 及创建时绑定的账号与搜索结果。 */
  const validateSender = (
    event: IpcMainInvokeEvent,
  ): ApplicationEntry<Context, Result> => {
    const entry = current;
    if (
      !entry ||
      entry.window.isDestroyed() ||
      event.sender !== entry.window.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== entry.url
    )
      throw new Error('申请窗口已失效');
    try {
      entry.validate();
    } catch (cause) {
      close();
      throw cause;
    }
    return entry;
  };

  ipcMain.handle(`${options.channel}:read`, (event): Context => {
    return { ...validateSender(event).context };
  });
  ipcMain.handle(`${options.channel}:close`, (event): void => {
    if (validateSender(event).submitting) throw new Error('请等待申请提交完成');
    close();
  });
  ipcMain.handle(
    `${options.channel}:submit`,
    async (event, value: unknown): Promise<void> => {
      const entry = validateSender(event);
      if (entry.submitting) throw new Error('正在提交，请勿重复操作');
      if (entry.submitted) throw new Error('申请已提交，请关闭窗口');
      const draft = options.parse(value);
      entry.submitting = true;
      try {
        const submission = await submit(entry.context, draft, (): void => {
          if (validateSender(event) !== entry)
            throw new Error('申请窗口已失效');
        });
        if (validateSender(event) !== entry) throw new Error('申请窗口已失效');
        entry.submission = submission;
        entry.submitted = true;
      } finally {
        entry.submitting = false;
      }
    },
  );

  /** 重复打开聚焦已有窗口；父窗口关闭、重载或崩溃时同步销毁。 */
  const open = async (
    parent: BrowserWindow,
    context: Context,
    validate: () => void,
  ): Promise<void> => {
    validate();
    if (current) {
      if (
        current.parent !== parent ||
        JSON.stringify(current.context) !== JSON.stringify(context)
      )
        throw new Error('请先关闭当前朋友验证窗口');
      current.validate();
      if (!current.window.webContents.isLoading()) {
        current.window.show();
        current.window.focus();
      }
      return;
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
      title: options.title,
      icon: getDefaultIcon(),
      webPreferences: {
        preload: path.join(__dirname, `${options.channel}-preload.cjs`),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const parentContents = parent.webContents;
    const url = new URL(getRendererUrl());
    url.hash = options.channel;
    /** 只清理本次窗口，旧加载回调不能关闭之后创建的新窗口。 */
    const disposeCurrent = (): void => {
      if (current === entry) close();
    };
    let finish: (submitted: boolean) => void = (): void => {};
    const result = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    let disposed = false;
    const entry: ApplicationEntry<Context, Result> = {
      window,
      parent,
      url: url.href,
      context: { ...context },
      submitting: false,
      submitted: false,
      submission: null,
      result,
      finish,
      validate,
      /** 解除父窗口监听，防止重复开关后累积事件。 */
      dispose: (): void => {
        if (disposed) return;
        disposed = true;
        parent.removeListener('closed', disposeCurrent);
        parentContents.removeListener('did-start-navigation', disposeCurrent);
        parentContents.removeListener('render-process-gone', disposeCurrent);
      },
    };
    current = entry;
    parent.on('closed', disposeCurrent);
    parentContents.on('did-start-navigation', disposeCurrent);
    parentContents.on('render-process-gone', disposeCurrent);
    window.on('closed', disposeCurrent);
    window.on('close', (event) => {
      if (entry.submitting) event.preventDefault();
    });
    window.webContents.on('render-process-gone', disposeCurrent);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    try {
      await window.loadURL(entry.url);
      if (current !== entry || window.isDestroyed()) return;
      validate();
      window.show();
      window.focus();
    } catch (cause) {
      disposeCurrent();
      throw cause;
    }
  };
  /** 验证调用方等待用户关闭窗口；取消和强制清理不能被当作审批成功。 */
  const openAndWait = async (
    parent: BrowserWindow,
    context: Context,
    validate: () => void,
  ): Promise<boolean> => {
    const opening = open(parent, context, validate);
    const entry = current;
    await opening;
    const result = await (entry?.result ?? Promise.resolve(false));
    validate();
    return result;
  };
  /** 返回本次已验证提交结果；取消、强制销毁和旧授权不能补入联系人。 */
  const openAndWaitResult = async (
    parent: BrowserWindow,
    context: Context,
    validate: () => void,
  ): Promise<Result | null> => {
    const opening = open(parent, context, validate);
    const entry = current;
    await opening;
    const submitted = await (entry?.result ?? Promise.resolve(false));
    validate();
    return submitted ? (entry?.submission ?? null) : null;
  };
  return { open, openAndWait, openAndWaitResult, close };
};

/** 保留添加朋友窗口原有入口和申请协议。 */
export const createFriendApplicationController = (
  getRendererUrl: () => string,
  getDefaultIcon: () => NativeImage,
  submit: (
    context: FriendApplicationContext,
    draft: FriendApplicationDraft,
    validate: () => void,
  ) => Promise<FriendApplicationSubmission>,
): ReturnType<
  typeof createFriendFormController<
    FriendApplicationContext,
    FriendApplicationDraft,
    FriendApplicationSubmission
  >
> =>
  createFriendFormController(
    getRendererUrl,
    getDefaultIcon,
    {
      channel: 'friend-application',
      title: '申请添加朋友',
      parse: parseFriendApplicationDraft,
    },
    submit,
  );
