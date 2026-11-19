import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { requestApi } from '../../../shared/api/api-client';
import {
  compareClientVersions,
  parseClientUpdateResponse,
} from '../../../shared/update/update';
import type {
  ClientUpdateInfo,
  UpdateDownloadProgress,
} from '../../../shared/update/update';

interface UpdateServiceOptions {
  base: () => string | undefined;
  currentVersion: string;
  directory: string;
}

/** 为设置窗口提供版本检查、受控下载和可取消的进度回调。 */
export const createUpdateService = ({
  base,
  currentVersion,
  directory,
}: UpdateServiceOptions) => {
  let controller: AbortController | undefined;

  /** 请求当前发布版本，只返回高于本地版本的记录。 */
  const check = async (): Promise<ClientUpdateInfo | null> => {
    const latest = await requestApi(
      { base: base() },
      {
        path: '/capi/update/public/latest/client',
        method: 'GET',
        serviceName: '版本检查',
        parse: parseClientUpdateResponse,
      },
    );
    if (!latest || compareClientVersions(latest.version, currentVersion) <= 0)
      return null;
    return latest;
  };

  /** 发送当前下载状态，避免把绝对路径或响应正文暴露给渲染进程。 */
  const report = (
    callback: (progress: UpdateDownloadProgress) => void,
    progress: UpdateDownloadProgress,
  ): void => {
    callback({
      loaded: Math.max(0, Math.floor(progress.loaded)),
      total: Math.max(0, Math.floor(progress.total)),
      percent: Math.min(100, Math.max(0, Math.floor(progress.percent))),
      status: progress.status,
    });
  };

  /** 下载并校验最新安装包，成功后返回应用运行目录内的文件路径。 */
  const download = async (
    releaseId: number,
    callback: (progress: UpdateDownloadProgress) => void,
  ): Promise<string> => {
    const latest = await check();
    if (!latest || latest.releaseId !== releaseId)
      throw new Error('客户端版本已变化，请重新检查更新');
    const parsedUrl = new URL(latest.downloadUrl);
    if (!['https:', 'http:'].includes(parsedUrl.protocol))
      throw new Error('更新下载地址无效');

    controller?.abort();
    controller = new AbortController();
    const activeController = controller;
    const safeName = path
      .basename(latest.clientName)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
    const target = path.join(directory, safeName);
    const partial = `${target}.${latest.sha256}.part`;
    let writer: ReturnType<typeof createWriteStream> | undefined;
    let loaded = 0;
    let total = latest.fileSize;
    try {
      await mkdir(directory, { recursive: true });
      const response = await fetch(parsedUrl, {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: activeController.signal,
      });
      if (!response.ok || !response.body)
        throw new Error(`更新下载失败（${response.status}）`);
      const headerLength = Number(response.headers.get('content-length'));
      total =
        Number.isSafeInteger(headerLength) && headerLength > 0
          ? headerLength
          : latest.fileSize;
      writer = createWriteStream(partial, { flags: 'w' });
      const hash = createHash('sha256');
      report(callback, { loaded, total, percent: 0, status: 'downloading' });
      const reader = response.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          activeController.signal.throwIfAborted();
          hash.update(chunk.value);
          loaded += chunk.value.byteLength;
          if (!writer.write(Buffer.from(chunk.value)))
            await new Promise<void>((resolve, reject) => {
              writer?.once('drain', resolve);
              writer?.once('error', reject);
            });
          report(callback, {
            loaded,
            total,
            percent: (loaded / total) * 100,
            status: 'downloading',
          });
        }
      } finally {
        reader.releaseLock();
      }
      await new Promise<void>((resolve, reject) => {
        writer?.once('error', reject);
        writer?.end(() => resolve());
      });
      writer = undefined;
      if (loaded !== latest.fileSize || hash.digest('hex') !== latest.sha256)
        throw new Error('更新文件校验失败，请重新下载');
      await rename(partial, target);
      report(callback, {
        loaded,
        total,
        percent: 100,
        status: 'completed',
      });
      return target;
    } catch (error) {
      writer?.destroy();
      await rm(partial, { force: true }).catch(() => undefined);
      if (activeController.signal.aborted) {
        report(callback, {
          loaded,
          total,
          percent: 0,
          status: 'cancelled',
        });
        throw new Error('更新下载已取消');
      }
      report(callback, {
        loaded,
        total: latest.fileSize,
        percent: 0,
        status: 'failed',
      });
      throw error;
    } finally {
      if (controller === activeController) controller = undefined;
    }
  };

  /** 取消当前安装包下载并清理临时文件。 */
  const cancel = (): void => {
    controller?.abort();
  };

  return { check, download, cancel };
};
