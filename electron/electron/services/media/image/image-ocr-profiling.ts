import type { InferenceSession } from 'onnxruntime-node';
import { open, readdir, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ImageOcrExecution,
  ImageOcrProvider,
} from '../../../../shared/media/image/image-ocr';

const maxProfileBytes = 16 * 1024 * 1024;
const gpuProviders = new Set([
  'DmlExecutionProvider',
  'CUDAExecutionProvider',
  'TensorrtExecutionProvider',
  'ROCMExecutionProvider',
  'WebGpuExecutionProvider',
]);

interface ProfileSession {
  session: InferenceSession;
  prefix?: string;
}

interface OcrProfiler {
  finish: (completed: boolean) => Promise<ImageOcrExecution>;
}

/** 只统计实际执行的内核事件；未知提供器或不完整证据不能被归类为纯 CPU/GPU。 */
export const summarizeOcrProfile = (
  profiles: unknown[],
  provider: ImageOcrProvider,
  completed: boolean,
  sessions: number,
  completeProfile: boolean,
): ImageOcrExecution => {
  const kernels: Record<string, number> = {};
  let unknownKernels = 0;
  let cpu = 0;
  let gpu = 0;
  let profiledSessions = 0;
  for (const profile of profiles) {
    if (!Array.isArray(profile)) {
      completeProfile = false;
      continue;
    }
    let executed = false;
    for (const event of profile as unknown[]) {
      if (!event || typeof event !== 'object') continue;
      if (!('cat' in event) || event.cat !== 'Node') continue;
      if (
        !('name' in event) ||
        typeof event.name !== 'string' ||
        !event.name.endsWith('_kernel_time')
      )
        continue;
      executed = true;
      const args = 'args' in event ? event.args : undefined;
      const name =
        args && typeof args === 'object' && 'provider' in args
          ? args.provider
          : undefined;
      if (
        typeof name !== 'string' ||
        !/^[A-Za-z][A-Za-z0-9_]{0,46}ExecutionProvider$/.test(name)
      ) {
        unknownKernels++;
        continue;
      }
      // 原始节点名、形状和调度线程信息不进入汇总或主进程日志。
      kernels[name] = (kernels[name] ?? 0) + 1;
      if (name === 'CPUExecutionProvider') cpu++;
      else if (gpuProviders.has(name)) gpu++;
      else unknownKernels++;
    }
    if (executed) profiledSessions++;
  }
  let execution: ImageOcrExecution['execution'] = 'unknown';
  if (completeProfile && unknownKernels === 0) {
    if (cpu > 0 && gpu > 0) execution = 'mixed';
    else if (gpu > 0) execution = 'gpu';
    else if (cpu > 0) execution = 'cpu';
  }
  return {
    execution,
    provider,
    completed,
    sessions,
    profiledSessions,
    kernels,
    unknownKernels,
    completeProfile,
  };
};

/** 每个原生会话使用独立前缀，避免检测/识别并行初始化时覆盖同秒的 profile 文件。 */
export const startOcrProfiling = (
  directory: string | undefined,
  provider: ImageOcrProvider,
  sessionClass: typeof InferenceSession,
): OcrProfiler => {
  const original = sessionClass.create;
  const sessions: ProfileSession[] = [];
  const pending: Promise<InferenceSession>[] = [];
  let completeProfile = Boolean(directory);
  const wrapped = new Proxy(original, {
    /** 只包装 SDK 使用的内存模型重载，保留其他调用参数及返回语义。 */
    apply: (
      target: typeof original,
      receiver: unknown,
      args: unknown[],
    ): Promise<InferenceSession> => {
      const model = args[0];
      const options = args[1];
      const validOptions =
        options && typeof options === 'object' ? options : undefined;
      const supported =
        directory &&
        args.length === 2 &&
        model instanceof Uint8Array &&
        validOptions;
      const prefix = supported
        ? path.join(directory, `session-${randomUUID()}`)
        : undefined;
      if (!prefix) completeProfile = false;
      const profiledArgs = prefix
        ? [
            model,
            {
              ...validOptions,
              enableProfiling: true,
              profileFilePrefix: prefix,
            },
          ]
        : args;
      /** profiling 自身失败时尝试原参数，不能让诊断阻断原本可用的推理。 */
      const create = async (): Promise<InferenceSession> => {
        let session: InferenceSession;
        let actualPrefix = prefix;
        try {
          session = await Reflect.apply(target, receiver, profiledArgs);
        } catch (error) {
          if (!prefix) throw error;
          actualPrefix = undefined;
          session = await Reflect.apply(target, receiver, args);
        }
        sessions.push({ session, prefix: actualPrefix });
        return session;
      };
      const request = create();
      pending.push(request);
      return request;
    },
  });
  sessionClass.create = wrapped;

  /** 在会话释放前关闭 profiling，再读取有界 JSON；任何诊断失败均返回未知。 */
  const finish = async (completed: boolean): Promise<ImageOcrExecution> => {
    const profiles: unknown[] = [];
    let totalBytes = 0;
    try {
      // SDK 并行创建两个会话，另一个失败时仍需等待在途创建及其 CPU 回退。
      let count: number;
      do {
        count = pending.length;
        await Promise.allSettled(pending);
      } while (count !== pending.length);
      for (const record of sessions) {
        if (!record.prefix || !directory) {
          completeProfile = false;
          continue;
        }
        try {
          record.session.endProfiling();
          const prefix = path.basename(record.prefix);
          const files = (await readdir(directory)).filter(
            (file) => file.startsWith(`${prefix}_`) && file.endsWith('.json'),
          );
          if (files.length !== 1) throw new Error('OCR profile 文件不完整');
          const handle = await open(path.join(directory, files[0]!), 'r');
          try {
            const info = await handle.stat();
            totalBytes += info.size;
            if (!info.isFile() || totalBytes > maxProfileBytes)
              throw new Error('OCR profile 超过诊断大小上限');
            const value: unknown = JSON.parse(await handle.readFile('utf8'));
            profiles.push(value);
          } finally {
            await handle.close();
          }
        } catch {
          completeProfile = false;
        }
      }
    } catch {
      completeProfile = false;
    } finally {
      sessionClass.create = original;
    }
    return summarizeOcrProfile(
      profiles,
      provider,
      completed,
      sessions.length,
      completeProfile,
    );
  };
  return { finish };
};

/** 只删除本次独立诊断目录的原生 profile 文件，不递归清理或删除其他应用产物。 */
export const cleanOcrProfiles = async (directory: string): Promise<void> => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/^session-[a-f0-9-]+_.+\.json$/.test(entry.name))
      continue;
    await rm(path.join(directory, entry.name), { force: true });
  }
  await rmdir(directory);
};
