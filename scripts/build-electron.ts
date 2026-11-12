import { buildElectron } from './electron-build';

void buildElectron().catch((error: unknown): void => {
  console.error(error);
  process.exitCode = 1;
});
