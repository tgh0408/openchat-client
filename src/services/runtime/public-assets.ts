/** 按页面位置解析公共资源；安装版固定从可执行文件旁的 public 读取。 */
export const publicAssetUrl = (asset: string): string => {
  const page = new URL(document.baseURI);
  const packaged =
    page.protocol === 'file:' &&
    /\/resources\/app\.asar\/dist\//.test(page.pathname);
  return new URL(packaged ? `../../../public/${asset}` : `./${asset}`, page)
    .href;
};

export const DEFAULT_AVATAR_URL = publicAssetUrl('avatar.jpeg');
