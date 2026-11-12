import { createRequire } from 'node:module';
import { run } from 'vue-tsc';

/** 使用官方兼容编译器检查 Vue 模板，避免依赖 TypeScript 7 已移除的内部接口。 */
const checkVueTypes = (): void => {
  const require = createRequire(import.meta.url);
  run(require.resolve('@typescript/typescript6/lib/tsc'));
};

checkVueTypes();
