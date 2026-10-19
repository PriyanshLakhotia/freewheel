import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { Connection, ThreadChoice } from '../../shared/types.js';
import { agentEnvironment } from '../agent-env.js';
const exec = promisify(execFile);
const binary = process.env.FREEWHEEL_AMP_BIN || 'amp';
export class AmpAdapter {
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  constructor(private key: () => string | undefined) {}
  private env() {
    return {
      ...agentEnvironment(),
      ...(this.key() ? { AMP_API_KEY: this.key() } : {}),
      AMP_UPDATE_CHECK: '0',
    };
  }
  async connection(): Promise<Connection> {
    try {
      await exec(binary, ['--version'], { timeout: 5000, env: this.env() });
      // Listing a single thread verifies the selected CLI account or supplied token without starting an agent.
      await exec(binary, ['threads', 'list', '--json', '--limit', '1'], {
        timeout: 12000,
        env: this.env(),
        maxBuffer: 512 * 1024,
      });
      return {
        available: true,
        connected: true,
        detail: this.key() ? 'Connected with access token' : 'Connected with Amp CLI login',
      };
    } catch (error: any) {
      return {
        available: error.code !== 'ENOENT',
        connected: false,
        detail:
          error.code === 'ENOENT'
            ? 'Install Amp CLI to connect'
            : 'Run amp login, or add an Amp access token',
      };
    }
  }
  async threads(): Promise<ThreadChoice[]> {
    const { stdout } = await exec(binary, ['threads', 'list', '--json', '--limit', '30'], {
      env: this.env(),
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const data = JSON.parse(stdout);
    const rows = Array.isArray(data) ? data : data.threads || data.data || [];
    return rows.map((t: any) => ({
      id: t.id || t.threadId,
      title: t.title || t.name || 'Untitled Amp thread',
      cwd: t.cwd,
      updatedAt: t.updatedAt,
    }));
  }
  run(
    id: string,
    cwd: string,
    prompt: string,
    threadId: string | undefined,
    onEvent: (message: any) => void,
    onEnd: (error?: Error) => void,
  ) {
    const args = threadId ? ['threads', 'continue', threadId] : [];
    args.push('--execute', '--stream-json', '--no-archive-after-execute', '--no-notifications');
    if (!threadId) args.push('--visibility', 'private', '--mode', 'medium');
    const child = spawn(binary, args, {
      cwd,
      env: this.env(),
      stdio: 'pipe',
      detached: process.platform !== 'win32',
    });
    this.processes.set(id, child);
    let finished = false;
    let stderr = '';
    let gotResult = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      this.processes.delete(id);
      onEnd(error);
    };
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const m = JSON.parse(line);
        if (m.type === 'result') gotResult = true;
        onEvent(m);
      } catch {
        /* CLI startup notices are not agent messages. */
      }
    });
    child.stderr.on('data', (buffer) => {
      stderr = (stderr + buffer.toString()).slice(-4000);
    });
    child.on('error', (error) => finish(error));
    child.on('exit', (code, signal) =>
      finish(
        signal
          ? new Error('Amp stopped.')
          : code !== 0
            ? new Error(stderr || `Amp exited with code ${code}`)
            : !gotResult
              ? new Error('Amp ended without a result. Check the thread before retrying.')
              : undefined,
      ),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  }
  stop(id: string) {
    const child = this.processes.get(id);
    if (!child) return;
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  close() {
    for (const id of this.processes.keys()) this.stop(id);
  }
}
