import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

export class RpcClient extends EventEmitter {
  private proc?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, {resolve:(v:any)=>void; reject:(e:Error)=>void; timer:NodeJS.Timeout}>();
  private starting?: Promise<void>;
  constructor(private binary = process.env.FREEWHEEL_CODEX_BIN || 'codex', private args = ['app-server', '--listen', 'stdio://']) { super(); }
  async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.connect().catch(error => { this.starting = undefined; throw error; });
    return this.starting;
  }
  private async connect() {
    const proc = this.proc = spawn(this.binary, this.args, { stdio: 'pipe', env: {...process.env, RUST_LOG: 'error'} });
    const lines = createInterface({ input: proc.stdout });
    lines.on('line', line => {
      let message: any; try { message = JSON.parse(line); } catch { return; }
      if (message.id !== undefined && !message.method) {
        const waiter = this.pending.get(message.id); if (!waiter) return;
        clearTimeout(waiter.timer); this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message || 'Codex request failed'));
        else waiter.resolve(message.result);
      } else this.emit('message', message);
    });
    // Consume stderr so a busy child cannot deadlock. Never forward raw logs or credentials.
    proc.stderr.on('data', () => {});
    const fail = (error: Error) => {
      if (this.proc !== proc) return;
      this.proc = undefined; this.starting = undefined;
      for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
      this.pending.clear(); this.emit('disconnect', error);
    };
    proc.on('error', error => fail(error));
    proc.on('exit', () => fail(new Error('Codex disconnected. Reconnect in Connections.')));
    await this.request('initialize', {clientInfo:{name:'freewheel', title:'Freewheel', version:'0.1.0'}});
    this.notify('initialized', {});
  }
  request(method:string, params:unknown = {}): Promise<any> {
    if (!this.proc) return Promise.reject(new Error('Codex is not connected'));
    const id = ++this.sequence;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex timed out: ${method}`)); }, 25000);
      this.pending.set(id, {resolve,reject,timer}); this.write({id,method,params});
    });
  }
  notify(method:string, params:unknown) { this.write({method,params}); }
  respond(id: number|string, result:unknown) { this.write({id,result}); }
  reject(id: number|string, message:string) { this.write({id,error:{code:-32601,message}}); }
  private write(message:unknown) { this.proc?.stdin.write(JSON.stringify(message)+'\n'); }
  close() { this.proc?.kill('SIGTERM'); }
}
