import { spawnSync } from 'node:child_process';

function candidates() {
  const configured = process.env.PYTHON?.trim();
  return [
    ...(configured ? [[configured, []]] : []),
    ['python3', []],
    ['python', []],
    ['py', ['-3']]
  ];
}

export function findPython() {
  for (const [command, prefix] of candidates()) {
    const probe = spawnSync(command, [...prefix, '-c', 'import sys; print(sys.version_info[0])'], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (probe.status === 0 && probe.stdout.trim() === '3') return { command, prefix };
  }
  throw new Error('Python 3 wurde nicht gefunden. Setze PYTHON auf den Python-3-Interpreter.');
}

export function runPython(args, options = {}) {
  const { command, prefix } = findPython();
  return spawnSync(command, [...prefix, ...args], {
    stdio: 'inherit',
    windowsHide: true,
    ...options
  });
}
