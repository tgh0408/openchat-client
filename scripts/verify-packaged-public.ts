import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { extractFile, listPackage, statFile, uncache } from '@electron/asar';

/** 递归列出普通文件，拒绝会把外部目录带入安装包的符号链接。 */
const listFiles = async (directory: string, prefix = ''): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(
        ...(await listFiles(path.join(directory, entry.name), relative)),
      );
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`资源目录包含非常规文件：${relative}`);
  }
  return files.sort();
};

/** 流式计算文件摘要，避免同时读入多个大型模型。 */
const hashFile = async (file: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

/** 校验外部 public 完整性，并按内容查找 ASAR 与安装目录中的重复资源。 */
export const verifyPackagedPublic = async (
  root: string,
  output: string,
): Promise<void> => {
  const source = path.join(root, 'public');
  const destination = path.join(output, 'public');
  const files = await listFiles(source);
  const installedFiles = await listFiles(destination);
  if (!files.length || JSON.stringify(files) !== JSON.stringify(installedFiles))
    throw new Error('安装目录 public 文件清单与源码不一致');

  const fingerprints = new Map<number, Map<string, string>>();
  let totalBytes = 0;
  for (const file of files) {
    const original = path.join(source, file);
    const installed = path.join(destination, file);
    const { size } = await stat(original);
    const hash = await hashFile(original);
    if (
      (await stat(installed)).size !== size ||
      (await hashFile(installed)) !== hash
    )
      throw new Error(`安装目录公共资源内容不一致：${file}`);
    const hashes = fingerprints.get(size) ?? new Map<string, string>();
    hashes.set(hash, file);
    fingerprints.set(size, hashes);
    totalBytes += size;
  }

  const archive = path.join(output, 'resources', 'app.asar');
  uncache(archive);
  for (const entry of listPackage(archive, { isPack: false })) {
    const relative = entry.replaceAll('\\', '/').replace(/^\//, '');
    const archivePath = path.normalize(relative);
    const info = statFile(archive, archivePath, false);
    if (!('size' in info)) continue;
    if (
      relative.startsWith('public/') ||
      (relative.startsWith('dist/') &&
        relative !== 'dist/index.html' &&
        !relative.startsWith('dist/assets/')) ||
      (relative.startsWith('dist-electron/') &&
        !/^dist-electron\/[^/]+\.cjs$/.test(relative))
    )
      throw new Error(`ASAR 包含不应打包的资源：${relative}`);
    const candidates = fingerprints.get(info.size);
    if (!candidates) continue;
    const hash = createHash('sha256')
      .update(extractFile(archive, archivePath))
      .digest('hex');
    const duplicate = candidates.get(hash);
    if (duplicate)
      throw new Error(
        `公共资源重复打包：public/${duplicate} 与 app.asar/${relative}`,
      );
  }

  for (const file of await listFiles(output)) {
    if (file.startsWith('public/')) continue;
    const absolute = path.join(output, file);
    const candidates = fingerprints.get((await stat(absolute)).size);
    if (!candidates) continue;
    const duplicate = candidates.get(await hashFile(absolute));
    if (duplicate)
      throw new Error(`公共资源重复打包：public/${duplicate} 与 ${file}`);
  }
  uncache(archive);
  console.log(
    `公共资源校验通过：${files.length} 个文件，${totalBytes} 字节；ASAR 与其他安装目录无重复副本。`,
  );
};
