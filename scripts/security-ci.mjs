import { spawnSync } from 'node:child_process';
import path from 'node:path';

function runStep(name, command, args, cwd) {
  const start = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  const durationMs = Date.now() - start;

  return {
    name,
    ok: result.status === 0,
    status: result.status ?? 1,
    durationMs,
  };
}

const root = process.cwd();
const cargoCmd = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const nodeCmd = process.execPath;
const vitestEntry = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const steps = [
  runStep('Frontend Security Suite', nodeCmd, [vitestEntry, 'run', '--config', 'vitest.config.ts'], root),
  runStep('Backend Security Suite', cargoCmd, ['test', '--test', 'security'], `${root}/src-tauri`),
];

console.log('\n=== Security CI Summary ===');
for (const step of steps) {
  const status = step.ok ? 'PASS' : 'FAIL';
  console.log(`${status.padEnd(5)} | ${step.name.padEnd(28)} | ${(step.durationMs / 1000).toFixed(2)}s`);
}

const failed = steps.find((s) => !s.ok);
if (failed) {
  console.error(`\nSecurity CI failed on: ${failed.name}`);
  process.exit(failed.status || 1);
}

console.log('\nAll security suites passed.');
