/** 升级确认小窗只读取版本号和提交本次选择，不开放下载或进程控制。 */
export interface UpdateConfirmApi {
  getVersion: () => Promise<string>;
  respond: (confirmed: boolean) => Promise<void>;
}
