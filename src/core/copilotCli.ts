import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const est = (s: string) => Math.ceil(s.length / 4);

export function estimateTokens(text: string): number {
  return est(text);
}

function firstExisting(candidates: string[]): string | null {
  for (const file of candidates) {
    if (file && fs.existsSync(file)) return file;
  }
  return null;
}

function pathFromRegistry(key: string): string[] {
  const query = spawnSync('reg.exe', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true });
  if (query.status !== 0) return [];
  const match = /Path\s+REG_\w+\s+(.+)/i.exec(query.stdout);
  if (!match) return [];
  return match[1].split(';').map((s) => s.trim()).filter(Boolean);
}

/** WinGet updates the user PATH, which a server started earlier cannot see. */
function windowsCopilotCandidates(): string[] {
  const found: string[] = [];
  const dirs = [
    ...pathFromRegistry('HKCU\\Environment'),
    ...pathFromRegistry('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
  ];
  for (const dir of dirs) {
    found.push(path.join(dir, 'copilot.exe'), path.join(dir, 'copilot.cmd'));
  }
  const local = process.env.LOCALAPPDATA;
  const packages = local ? path.join(local, 'Microsoft', 'WinGet', 'Packages') : '';
  if (packages && fs.existsSync(packages)) {
    for (const entry of fs.readdirSync(packages)) {
      if (entry.toLowerCase().startsWith('github.copilot')) {
        found.push(path.join(packages, entry, 'copilot.exe'));
      }
    }
  }
  if (process.env.APPDATA) found.push(path.join(process.env.APPDATA, 'npm', 'copilot.cmd'));
  return found;
}

export function resolveCopilotBin(): string | null {
  const fromEnv = process.env.COPILOT_CLI;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const found = spawnSync(finder, ['copilot'], { encoding: 'utf8', windowsHide: true });
  if (found.status === 0) {
    const line = found.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (line) return line;
  }
  if (process.platform === 'win32') return firstExisting(windowsCopilotCandidates());
  return null;
}

export function proxySummary(): { configured: boolean; label: string } {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
  if (!raw) return { configured: false, label: '' };
  try {
    const url = new URL(raw);
    return { configured: true, label: `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}` };
  } catch {
    return { configured: true, label: 'set (invalid URL)' };
  }
}

function copilotChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const https = process.env.HTTPS_PROXY || process.env.https_proxy;
  const http = process.env.HTTP_PROXY || process.env.http_proxy;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (https) {
    env.HTTPS_PROXY = https;
    env.https_proxy = https;
  }
  if (http) {
    env.HTTP_PROXY = http;
    env.http_proxy = http;
  }
  if (noProxy) {
    env.NO_PROXY = noProxy;
    env.no_proxy = noProxy;
  }
  if (env.COPILOT_AUTO_UPDATE === undefined) env.COPILOT_AUTO_UPDATE = 'false';
  return env;
}

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
}

export function explainCopilotFailure(message: string): string {
  const proxy = proxySummary();
  const lower = message.toLowerCase();
  const bits = [message.trim()];
  if (/407|proxy authentication|proxy auth/.test(lower)) {
    bits.push('The proxy requires credentials. Set HTTPS_PROXY to http://user:password@proxy-host:port');
  } else if (/unable_to_verify_leaf_signature|self_signed_cert|unable to verify|certificate/.test(lower)) {
    bits.push('Corporate TLS inspection: set NODE_EXTRA_CA_CERTS to your company root CA .pem file and start the server again.');
  } else if (/enotfound|econnrefused|etimedout|econnreset|network|proxy/.test(lower)) {
    bits.push(proxy.configured
      ? `Proxy in use: ${proxy.label}. Check that it can reach github.com and api.githubcopilot.com, and that NO_PROXY includes localhost,127.0.0.1.`
      : 'No HTTPS_PROXY is set. On the corporate network set HTTPS_PROXY (and NO_PROXY=localhost,127.0.0.1) before starting the server.');
  } else if (/not logged|login|unauthori[sz]ed|401|403|authenticate|authentication/.test(lower)) {
    bits.push('Sign in once with the Copilot CLI (`copilot`). That uses your GitHub Copilot subscription. A model API key is not used.');
  }
  if (/not found|enoent/.test(lower) && /copilot/.test(lower)) {
    bits.push('Install GitHub Copilot CLI: winget install --id GitHub.Copilot   or   npm install -g @github/copilot');
  }
  return bits.join(' ');
}

export interface CopilotRunOptions {
  cwd: string;
  prompt: string;
  /** Frontmatter name of a custom agent in `.github/agents`. */
  agent: string;
  model?: string;
  timeoutMs: number;
  onLine?: (line: string) => void;
}

export function runCopilot(options: CopilotRunOptions): Promise<string> {
  const bin = resolveCopilotBin();
  if (!bin) {
    return Promise.reject(new Error(explainCopilotFailure(
      'GitHub Copilot CLI was not found on PATH. Install it and sign in with `copilot` (Copilot subscription, no model API key).'
    )));
  }

  const args: string[] = ['--no-ask-user', '--allow-all-tools', '--allow-all-paths', '--add-dir', options.cwd];
  if (options.model) args.push('--model', options.model);
  args.push('--agent', options.agent);
  if (options.agent && /[&|<>^%"`]/.test(options.agent)) {
    return Promise.reject(new Error('The custom agent name contains characters the Copilot CLI cannot take safely. Rename it in the agent file.'));
  }

  const windowsCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);

  return new Promise((resolve, reject) => {
    const env = copilotChildEnv();
    const binDir = path.dirname(bin);
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
    env[pathKey] = `${binDir}${path.delimiter}${env[pathKey] || env.PATH || ''}`;

    const child = spawn(bin, args, {
      cwd: options.cwd,
      env,
      windowsHide: true,
      shell: windowsCmd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutCarry = '';
    let stderrCarry = '';
    let settled = false;

    const finish = (err: Error | null, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(text ?? '');
    };

    const killTree = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
      } else {
        child.kill('SIGKILL');
      }
    };

    const timer = setTimeout(() => {
      killTree();
      finish(new Error(`GitHub Copilot timed out after ${Math.round(options.timeoutMs / 1000)}s.`));
    }, options.timeoutMs);

    const consume = (chunk: string, which: 'out' | 'err') => {
      const merged = (which === 'out' ? stdoutCarry : stderrCarry) + chunk;
      const parts = merged.split(/\n/);
      const rest = parts.pop() ?? '';
      if (which === 'out') stdoutCarry = rest;
      else stderrCarry = rest;
      if (!options.onLine) return;
      for (const part of parts) {
        const line = stripAnsi(part).trim();
        if (!line) continue;
        options.onLine(line.length > 300 ? line.slice(0, 300) + '…' : line);
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      consume(chunk, 'out');
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      consume(chunk, 'err');
    });
    child.on('error', (err) => finish(new Error(explainCopilotFailure(err.message))));
    child.on('close', (code) => {
      const text = stripAnsi(stdout).trim();
      if (code === 0 && text) {
        finish(null, text);
        return;
      }
      if (code === 0) {
        finish(null, text);
        return;
      }
      const detail = stripAnsi(stderr).trim() || text || `copilot exited with code ${code}`;
      finish(new Error(explainCopilotFailure(detail)));
    });

    child.stdin.write(options.prompt);
    child.stdin.end();
  });
}
