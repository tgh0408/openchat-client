import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { OpenChatStatus } from '../../../shared/update/update';

const execFileAsync = promisify(execFile);
const WECHAT_PROCESS_NAMES = ['WeChat.exe', 'Weixin.exe'] as const;

/** 检查 Windows OpenChat进程状态，不向渲染进程暴露任务列表或进程详情。 */
export const getOpenChatStatus = async (): Promise<OpenChatStatus> => {
  if (process.platform !== 'win32') return 'stopped';
  try {
    const result = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
      windowsHide: true,
      timeout: 3000,
      maxBuffer: 64 * 1024,
    });
    const runningNames = new Set(
      result.stdout
        .split(/\r?\n/)
        .map((line) => /^"([^"]+)"/.exec(line)?.[1]?.toLowerCase())
        .filter((name): name is string => name !== undefined),
    );
    return WECHAT_PROCESS_NAMES.some((name) =>
      runningNames.has(name.toLowerCase()),
    )
      ? 'running'
      : 'stopped';
  } catch {
    return 'unknown';
  }
};

/** 结束用户确认关闭的OpenChat进程，并等待进程树退出。 */
export const closeOpenChat = async (): Promise<boolean> => {
  if (process.platform !== 'win32') return true;
  const status = await getOpenChatStatus();
  if (status === 'stopped') return true;
  if (status === 'unknown') return false;
  for (const name of WECHAT_PROCESS_NAMES) {
    await execFileAsync('taskkill', ['/IM', name, '/T'], {
      windowsHide: true,
      timeout: 3000,
      maxBuffer: 64 * 1024,
    }).catch(() => undefined);
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 300);
    });
    if ((await getOpenChatStatus()) === 'stopped') return true;
  }
  return false;
};
