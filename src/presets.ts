// 本地预设存储：版本化快照 + 损坏隔离。
// 版本策略：拒绝旧版本（version 不是当前版本号的快照一律拒绝加载，不做迁移）。
// 存储仅使用 localStorage，不写入 URL，也不参与任何缺陷计算。

export type DefectType = 'vacancy' | 'substitution' | 'dislocation';

export interface ParamSnapshot {
  version: 1;
  defect: DefectType;
  cells: number;
  planeOpacity: number;
  showBonds: boolean;
}

export const SNAPSHOT_VERSION = 1;
const DEFECT_TYPES: readonly DefectType[] = ['vacancy', 'substitution', 'dislocation'];

export interface PresetRecord {
  id: string;
  name: string;
  createdAt: number;
  snapshot: ParamSnapshot;
}

interface PresetStore {
  version: 1;
  presets: PresetRecord[];
}

export interface QuarantineEntry {
  id: string;
  name: string;
  reason: string;
  at: number;
  raw: unknown;
}

export interface StartupReport {
  store: PresetStore;
  quarantined: QuarantineEntry[];
  restored: { snapshot: ParamSnapshot; activePresetId: string | null; dirty: boolean } | null;
  restoredIssue: string | null;
}

const PRESETS_KEY = 'crystal-defect.presets.v1';
const QUARANTINE_KEY = 'crystal-defect.quarantine.v1';
const SESSION_KEY = 'crystal-defect.session.v1';

export const DEFAULT_SNAPSHOT: ParamSnapshot = {
  version: SNAPSHOT_VERSION,
  defect: 'vacancy',
  cells: 4,
  planeOpacity: 0.08,
  showBonds: true,
};

export class SnapshotValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 严格校验快照：字段缺失/类型错误/取值越界都算损坏。
export function validateSnapshot(value: unknown): ParamSnapshot {
  if (!isRecord(value)) throw new SnapshotValidationError('快照不是对象');
  if (value.version !== SNAPSHOT_VERSION) {
    throw new SnapshotValidationError(
      typeof value.version === 'number'
        ? `旧版本快照 v${value.version}，当前仅支持 v${SNAPSHOT_VERSION}`
        : '快照缺少版本号',
    );
  }
  if (typeof value.defect !== 'string' || !DEFECT_TYPES.includes(value.defect as DefectType)) {
    throw new SnapshotValidationError('缺陷类型无效');
  }
  if (typeof value.cells !== 'number' || !Number.isInteger(value.cells) || value.cells < 3 || value.cells > 5) {
    throw new SnapshotValidationError('晶胞数量越界');
  }
  if (
    typeof value.planeOpacity !== 'number' ||
    !Number.isFinite(value.planeOpacity) ||
    value.planeOpacity < 0 ||
    value.planeOpacity > 0.3
  ) {
    throw new SnapshotValidationError('晶面透明度越界');
  }
  if (typeof value.showBonds !== 'boolean') {
    throw new SnapshotValidationError('连接线状态无效');
  }
  return {
    version: SNAPSHOT_VERSION,
    defect: value.defect as DefectType,
    cells: value.cells,
    planeOpacity: value.planeOpacity,
    showBonds: value.showBonds,
  };
}

function readJSON(key: string): unknown {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  return JSON.parse(raw);
}

function writeJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function readQuarantine(): QuarantineEntry[] {
  try {
    const data = readJSON(QUARANTINE_KEY);
    return Array.isArray(data) ? (data as QuarantineEntry[]) : [];
  } catch {
    return [];
  }
}

// 隔离损坏记录：追加到独立键，并立刻持久化，避免和正常预设混在一起。
function quarantine(entries: QuarantineEntry[]): QuarantineEntry[] {
  if (entries.length === 0) return readQuarantine();
  const merged = [...readQuarantine(), ...entries];
  try {
    writeJSON(QUARANTINE_KEY, merged);
  } catch {
    // 隔离区写不进去时保留在内存中，至少不污染正常预设。
  }
  return merged;
}

function emptyStore(): PresetStore {
  return { version: SNAPSHOT_VERSION, presets: [] };
}

// 解析单条预设记录，失败时返回隔离条目。
function parseRecord(raw: unknown, index: number): { ok: true; record: PresetRecord } | { ok: false; entry: QuarantineEntry } {
  const fallbackName = () =>
    isRecord(raw) && typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `损坏记录 #${index + 1}`;
  if (!isRecord(raw)) {
    return { ok: false, entry: { id: `q-${Date.now()}-${index}`, name: fallbackName(), reason: '记录不是对象', at: Date.now(), raw } };
  }
  if (typeof raw.id !== 'string' || !raw.id) {
    return { ok: false, entry: { id: `q-${Date.now()}-${index}`, name: fallbackName(), reason: '缺少预设 ID', at: Date.now(), raw } };
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    return { ok: false, entry: { id: `q-${Date.now()}-${index}`, name: `未命名预设 ${raw.id}`, reason: '预设名称无效', at: Date.now(), raw } };
  }
  try {
    const snapshot = validateSnapshot(raw.snapshot);
    return { ok: true, record: { id: raw.id, name: raw.name.trim(), createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(), snapshot } };
  } catch (error) {
    return {
      ok: false,
      entry: { id: `q-${Date.now()}-${index}`, name: raw.name.trim(), reason: error instanceof Error ? error.message : '快照无效', at: Date.now(), raw },
    };
  }
}

// 读取预设库：结构整体损坏 -> 整体隔离；单条损坏 -> 逐条隔离，其余照常可用。
function readPresetStore(): { store: PresetStore; entries: QuarantineEntry[] } {
  let data: unknown;
  try {
    data = readJSON(PRESETS_KEY);
  } catch (error) {
    const entries: QuarantineEntry[] = [
      { id: `q-${Date.now()}-store`, name: '预设库（无法解析）', reason: error instanceof Error ? error.message : 'JSON 解析失败', at: Date.now(), raw: null },
    ];
    return { store: emptyStore(), entries };
  }
  if (data === null) return { store: emptyStore(), entries: [] };
  if (!isRecord(data) || !Array.isArray(data.presets)) {
    return {
      store: emptyStore(),
      entries: [{ id: `q-${Date.now()}-store`, name: '预设库（结构损坏）', reason: '预设库结构无法识别', at: Date.now(), raw: data }],
    };
  }
  const records: PresetRecord[] = [];
  const entries: QuarantineEntry[] = [];
  data.presets.forEach((raw: unknown, index: number) => {
    const result = parseRecord(raw, index);
    if (result.ok) records.push(result.record);
    else entries.push(result.entry);
  });
  return { store: { version: SNAPSHOT_VERSION, presets: records }, entries };
}

export function loadStartup(): StartupReport {
  try {
    return loadStartupUnsafe();
  } catch {
    // localStorage 被禁用等极端情况：退化为内存模式，不阻断界面启动。
    return { store: emptyStore(), quarantined: [], restored: null, restoredIssue: '本地存储不可用，预设与刷新恢复本次停用' };
  }
}

function loadStartupUnsafe(): StartupReport {
  const { store, entries } = readPresetStore();
  let quarantined = quarantine(entries);
  if (entries.length > 0) {
    try {
      writeJSON(PRESETS_KEY, store);
    } catch {
      /* 写回失败时仅以内存中的干净列表运行 */
    }
  }

  // 恢复上次工作参数（刷新恢复）。会话槽损坏或为旧版本时静默回退默认值。
  let restored: StartupReport['restored'] = null;
  let restoredIssue: string | null = null;
  try {
    const session = readJSON(SESSION_KEY);
    if (session !== null) {
      if (isRecord(session) && session.version === SNAPSHOT_VERSION && isRecord(session.state)) {
        const state: Record<string, unknown> = session.state;
        try {
          const snapshot = validateSnapshot(state.snapshot);
          const activePresetId =
            typeof state.activePresetId === 'string' && store.presets.some(item => item.id === state.activePresetId)
              ? (state.activePresetId as string)
              : null;
          restored = { snapshot, activePresetId, dirty: state.dirty === true };
        } catch (error) {
          restoredIssue = '上次会话记录已损坏，已使用默认参数';
          quarantine([{
            id: `q-${Date.now()}-session`,
            name: '会话记录（损坏）',
            reason: error instanceof Error ? error.message : '会话快照无效',
            at: Date.now(),
            raw: session,
          }]);
          quarantined = readQuarantine();
        }
      } else if (isRecord(session) && typeof session.version === 'number' && session.version !== SNAPSHOT_VERSION) {
        restoredIssue = '上次会话来自旧版本，已使用默认参数';
      } else {
        restoredIssue = '上次会话记录已损坏，已使用默认参数';
        quarantine([{ id: `q-${Date.now()}-session`, name: '会话记录（损坏）', reason: '会话结构无法识别', at: Date.now(), raw: session }]);
        quarantined = readQuarantine();
      }
    }
  } catch (error) {
    restoredIssue = error instanceof SnapshotValidationError && /旧版本/.test(error.message)
      ? '上次会话来自旧版本，已使用默认参数'
      : '上次会话记录已损坏，已使用默认参数';
  }

  return { store, quarantined, restored, restoredIssue };
}

export function persistPresets(presets: PresetRecord[]): void {
  writeJSON(PRESETS_KEY, { version: SNAPSHOT_VERSION, presets } satisfies PresetStore);
}

export interface SessionState {
  snapshot: ParamSnapshot;
  activePresetId: string | null;
  dirty: boolean;
}

export function saveSession(state: SessionState): void {
  writeJSON(SESSION_KEY, { version: SNAPSHOT_VERSION, state });
}

export function createId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 仅供隔离提示条展示数量使用。
export function countQuarantined(): number {
  return readQuarantine().length;
}

// 运行时加载预设时若发现被外部篡改/旧版本，将该记录隔离并返回剩余预设列表。
export function quarantinePreset(presets: PresetRecord[], id: string, reason: string): PresetRecord[] {
  const target = presets.find(item => item.id === id);
  if (target) {
    quarantine([{ id: `q-${Date.now()}-${id}`, name: target.name, reason, at: Date.now(), raw: target }]);
  }
  return presets.filter(item => item.id !== id);
}

export function clearQuarantine(): void {
  try {
    localStorage.removeItem(QUARANTINE_KEY);
  } catch {
    /* 忽略 */
  }
}
