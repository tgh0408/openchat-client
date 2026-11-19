import { machineId } from 'node-machine-id';
import { CLIENT_PLATFORM } from './client-identity';
import {
  initializeDeviceId,
  parseDeviceId,
} from '../../../shared/auth/device-identity';

/** 主进程读取本机系统标识摘要；失败时禁止启动，不回退到随机设备。 */
export const initializeElectronDeviceIdentity = async (): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const id = await Promise.race([
      machineId(false),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('读取设备标识超时')), 10000);
      }),
    ]);
    initializeDeviceId(parseDeviceId(id), CLIENT_PLATFORM);
  } catch {
    throw new Error('无法读取本机设备标识，请检查系统权限后重新启动');
  } finally {
    clearTimeout(timer);
  }
};
