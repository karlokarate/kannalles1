import { spawn } from 'node:child_process';

const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = npmCli
  ? [npmCli, 'audit', '--audit-level=high', '--json']
  : ['audit', '--audit-level=high', '--json'];
const child = spawn(command, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NPM_CONFIG_FETCH_TIMEOUT: process.env.NPM_CONFIG_FETCH_TIMEOUT || '30000',
    NPM_CONFIG_FETCH_RETRIES: process.env.NPM_CONFIG_FETCH_RETRIES || '1',
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT: process.env.NPM_CONFIG_FETCH_RETRY_MINTIMEOUT || '1000',
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT: process.env.NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT || '5000'
  }
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });

const timeoutMs = Number(process.env.KH_AUDIT_TIMEOUT_MS || 75_000);
const timer = setTimeout(() => {
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
}, timeoutMs);

const result = await new Promise((resolve) => {
  child.on('error', (error) => resolve({ code: 1, error }));
  child.on('close', (code, signal) => resolve({ code: code ?? 1, signal }));
});
clearTimeout(timer);

if (result.signal) {
  console.error(`npm audit exceeded ${timeoutMs} ms and was terminated (${result.signal}).`);
  if (stderr.trim()) console.error(stderr.trim());
  process.exit(1);
}

let report;
try {
  report = JSON.parse(stdout);
} catch {
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
  process.exit(result.code);
}

const vulnerabilities = report?.metadata?.vulnerabilities ?? {};
console.log(`npm audit: ${vulnerabilities.total ?? 0} total, ${vulnerabilities.high ?? 0} high, ${vulnerabilities.critical ?? 0} critical.`);
if (stderr.trim()) console.error(stderr.trim());
process.exit(result.code);
