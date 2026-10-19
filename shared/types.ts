export type Agent = 'amp' | 'codex';
export type TaskStatus = 'running' | 'waiting' | 'completed' | 'error' | 'stopped';
export interface Project { id: string; name: string; path: string }
export interface Task {
  id: string; agent: Agent; projectId: string; prompt: string; status: TaskStatus;
  externalId?: string; turnId?: string; output: string; summary: string; activity: string;
  createdAt: number; updatedAt: number; error?: string;
}
export interface Question { id: string; question: string; options?: { label: string; description: string }[] }
export interface Approval {
  id: string; number: number; taskId: string; agent: Agent; kind: 'command' | 'files' | 'question';
  title: string; detail: string; questions?: Question[]; createdAt: number;
}
export interface Connection { available: boolean; connected: boolean; detail: string }
export interface Settings {
  recognition: 'browser' | 'offline'; speech: 'system' | 'openai';
  transcription: 'recognizer' | 'openai'; voice: string; rate: number; confirmTasks: boolean; followUpSeconds: number;
  quiet: boolean; audioBudget: number;
}
export interface State {
  projects: Project[]; tasks: Task[]; approvals: Approval[]; settings: Settings;
  connections: Record<Agent, Connection>; credentials: { amp: boolean; openai: boolean };
  awake: boolean; platform: string; modelReady: boolean; audioSpend: number;
}
export interface ThreadChoice { id: string; title: string; cwd?: string; updatedAt?: number }
export type ServerEvent = { type: 'state'; state: State } | { type: 'announce'; id: string; agent?: Agent; text: string };
export const agentName = (agent: Agent) => agent === 'amp' ? 'Puck' : 'Codex';
export const DEFAULT_SETTINGS: Settings = { recognition: 'browser', transcription: 'recognizer', speech: 'system', voice: '', rate: 1.06, confirmTasks: true, followUpSeconds: 10, quiet: false, audioBudget: 2 };
