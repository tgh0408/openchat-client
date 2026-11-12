/** 给当前 DOM 更新一次绘制机会，绘制后的任务继续执行，不再等下一次垂直同步。 */
export const waitForScreenshotPaint = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
