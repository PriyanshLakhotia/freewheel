import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_SETTINGS, type Project, type Settings, type Task } from '../shared/types.js';
export const dataDir =
  process.env.FREEWHEEL_DATA_DIR || join(homedir(), '.local', 'share', 'freewheel');
export interface Saved {
  projects: Project[];
  tasks: Task[];
  settings: Settings;
}
export function loadState(): Saved {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try {
    const data = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')) as Saved;
    return {
      projects: data.projects || [],
      tasks: (data.tasks || []).map((t) =>
        ['running', 'waiting'].includes(t.status)
          ? {
              ...t,
              status: 'stopped',
              activity: 'Companion restarted. Continue this conversation when ready.',
            }
          : t,
      ),
      settings: { ...DEFAULT_SETTINGS, ...data.settings },
    };
  } catch {
    return {
      projects: [{ id: 'default', name: 'Freewheel', path: process.cwd() }],
      tasks: [],
      settings: { ...DEFAULT_SETTINGS },
    };
  }
}
export function saveState(data: Saved) {
  const path = join(dataDir, 'state.json');
  writeFileSync(
    path + '.tmp',
    JSON.stringify({ ...data, tasks: data.tasks.slice(-200) }, null, 2),
    { mode: 0o600 },
  );
  renameSync(path + '.tmp', path);
}
