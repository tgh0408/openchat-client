interface NotificationWindow {
  isDestroyed: () => boolean;
  readonly webContents: {
    isDestroyed: () => boolean;
    send: (channel: string, payload: unknown) => void;
  };
}

/** 只向仍存活的窗口页面发送通知；窗口销毁后不再读取其 webContents。 */
export const sendWindowNotification = (
  window: NotificationWindow | undefined,
  channel: string,
  payload: unknown,
): void => {
  if (!window || window.isDestroyed()) return;
  const contents = window.webContents;
  if (contents.isDestroyed()) return;
  contents.send(channel, payload);
};
