import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, Platform, Arch } from 'electron-builder';

/** 打包 Windows x64，签名和制作安装程序之前校验公共资源，失败即中止。 */
const buildWindowsInstaller = async (
  root: string,
  directoryOnly: boolean,
): Promise<void> => {
  await build({
    projectDir: root,
    targets: Platform.WINDOWS.createTarget(
      directoryOnly ? 'dir' : 'nsis',
      Arch.x64,
    ),
    config: {
    },
  });
};

/** 计算安装包的 SHA-256 并写入同目录校验文件。 */
const writeInstallerChecksums = async (root: string): Promise<void> => {
  const releaseDirectory = path.join(root, 'release');
  const entries = await readdir(releaseDirectory, { withFileTypes: true });
  const installers = entries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'),
    )
    .map((entry) => entry.name)
    .sort();

  if (installers.length === 0) {
    throw new Error(`未在 ${releaseDirectory} 找到 Windows 安装包`);
  }

  for (const installer of installers) {
    const installerPath = path.join(releaseDirectory, installer);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(installerPath)) {
      hash.update(chunk);
    }
    const checksumPath = `${installerPath}.sha256`;
    await writeFile(
      checksumPath,
      `${hash.digest('hex')} *${installer}\n`,
      'utf8',
    );
    console.log(`已生成 SHA-256：${path.relative(root, checksumPath)}`);
  }
};

/** 执行 Windows 打包并生成安装包校验文件。 */
const packageWindows = async (): Promise<void> => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directoryOnly = process.argv.includes('--dir');
  await buildWindowsInstaller(root, directoryOnly);
  if (!directoryOnly) await writeInstallerChecksums(root);
};

void packageWindows().catch((error: unknown): void => {
  console.error(error);
  process.exitCode = 1;
  // 打包依赖的退出清理可能覆盖退出码，沿用 electron-builder CLI 的失败保护。
  process.once('exit', (): void => {
    process.exitCode = 1;
  });
});
