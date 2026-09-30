// 本地预设：版本化快照的保存 / 加载 / 删除 / 刷新恢复 / 损坏隔离。
// 仅使用 localStorage，不写入 URL；缺陷计算逻辑在 App.tsx 中，与此处无关。

export type DefectType = 'vacancy' | 'substitution' | 'dislocation';

// ---------- 可预设参数（唯一允许进入快照的值） ----------
export type Params = { defect: DefectType; cells: number; showBonds: boolean; planeOpacity: number };

export const SCHEMA_VERSION = 1;
export const PRESETS_KEY = 'crystal-defect-lab.presets.v1';
export const WORKSPACE_KEY = 'crystal-defect-lab.workspace.v1';
export const QUARANTINE_KEY = 'crystal-defect-lab.quarantine.v1';
export const DEFAULT_PARAMS: Params = { defect: 'vacancy', cells: 4, showBonds: true, planeOpacity: .08 };

// 版本化快照：加载时整体替换 params，任何字段都不单独合并
export type PresetSnapshot = { version: 1; params: Params };
export type PresetRecord = { id: string; name: string; createdAt: number; snapshot: PresetSnapshot };
export type QuarantineSource = 'presets' | 'workspace';
export type QuarantineEntry = { id: string; source: QuarantineSource; reason: string; raw: string; quarantinedAt: number };
export type BootResult = {
  params: Params;
  activePresetId: string | null;
  presets: PresetRecord[];
  quarantine: QuarantineEntry[];
  newIssues: string[];
};

export const defectLabel: Record<DefectType, string> = {
  vacancy: '空位', substitution: '替位', dislocation: '刃型位错',
};
export function summarizeParams(p: Params) {
  return `${defectLabel[p.defect]} · ${p.cells}³ · 透明度${Math.round(p.planeOpacity * 100)}% · 连接线${p.showBonds ? '开' : '关'}`;
}
export function sameParams(a: Params, b: Params) {
  return a.defect === b.defect && a.cells === b.cells && a.showBonds === b.showBonds && a.planeOpacity === b.planeOpacity;
}
export function uid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* 回退到随机串 */ }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------- 校验：拒绝旧版本 + 任何越界 / 损坏值 ----------
export function isValidParams(value: unknown): value is Params {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (p.defect === 'vacancy' || p.defect === 'substitution' || p.defect === 'dislocation')
    && typeof p.cells === 'number' && Number.isInteger(p.cells) && p.cells >= 3 && p.cells <= 5
    && typeof p.showBonds === 'boolean'
    && typeof p.planeOpacity === 'number' && Number.isFinite(p.planeOpacity) && p.planeOpacity >= 0 && p.planeOpacity <= .3;
}
export function validatePresetRecord(value: unknown): { ok: true; record: PresetRecord } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object') return { ok: false, reason: '预设记录结构损坏（不是对象），已隔离' };
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return { ok: false, reason: '预设记录缺少有效 id，已隔离' };
  if (typeof r.name !== 'string' || !r.name.trim()) return { ok: false, reason: '预设记录缺少名称，已隔离' };
  const snapshot = r.snapshot;
  if (!snapshot || typeof snapshot !== 'object') return { ok: false, reason: `预设「${r.name}」缺少版本化快照，已隔离` };
  const version = (snapshot as Record<string, unknown>).version;
  // 策略：拒绝旧版本（不迁移）
  if (version !== SCHEMA_VERSION) {
    return { ok: false, reason: `预设「${r.name}」的快照版本为 ${String(version)}，当前仅支持 v${SCHEMA_VERSION}，已拒绝并隔离` };
  }
  const snapshotParams = (snapshot as Record<string, unknown>).params;
  if (!isValidParams(snapshotParams)) return { ok: false, reason: `预设「${r.name}」的快照参数校验失败，已隔离` };
  // 显式重建，只保留四个受管字段，避免多余属性穿透进快照
  const params: Params = {
    defect: snapshotParams.defect,
    cells: snapshotParams.cells,
    showBonds: snapshotParams.showBonds,
    planeOpacity: snapshotParams.planeOpacity,
  };
  return {
    ok: true,
    record: {
      id: r.id,
      name: r.name,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
      snapshot: { version: SCHEMA_VERSION, params },
    },
  };
}

// ---------- 存储后端（浏览器用 localStorage；测试可注入内存实现） ----------
type StoreBackend = { getItem(key: string): string | null; setItem(key: string, value: string): void } | null;
let backendOverride: StoreBackend;
export function setStoreBackend(backend: StoreBackend) { backendOverride = backend; }
function resolveBackend(): StoreBackend {
  if (backendOverride !== undefined) return backendOverride;
  try { return window.localStorage; } catch { return null; }
}
export function readRaw(key: string): string | null {
  const s = resolveBackend();
  if (!s) return null;
  try { return s.getItem(key); } catch { return null; }
}
export function writeRaw(key: string, value: string): boolean {
  const s = resolveBackend();
  if (!s) return false;
  try { s.setItem(key, value); return true; } catch { return false; }
}
function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}
export function readQuarantine(): QuarantineEntry[] {
  const raw = readRaw(QUARANTINE_KEY);
  if (raw == null) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      const e = entry as Record<string, unknown>;
      if (typeof e.reason !== 'string' || typeof e.raw !== 'string') return [];
      return [{
        id: typeof e.id === 'string' ? e.id : uid(),
        source: e.source === 'workspace' ? 'workspace' : 'presets',
        reason: e.reason,
        raw: e.raw,
        quarantinedAt: typeof e.quarantinedAt === 'number' ? e.quarantinedAt : Date.now(),
      }];
    });
  } catch { return []; }
}

// ---------- 启动引导：预设库 + 工作区快照，损坏即隔离 ----------
export function boot(): BootResult {
  const newIssues: string[] = [];
  let quarantine = readQuarantine();
  const pushQuarantine = (source: QuarantineSource, reason: string, raw: string) => {
    // 同源、同原因、同内容只隔离一次，避免重复提示
    if (quarantine.some(e => e.source === source && e.reason === reason && e.raw === raw)) return;
    quarantine = [...quarantine, { id: uid(), source, reason, raw, quarantinedAt: Date.now() }];
    newIssues.push(reason);
  };

  // 预设库
  let presets: PresetRecord[] = [];
  const presetsRaw = readRaw(PRESETS_KEY);
  if (presetsRaw != null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(presetsRaw);
    } catch {
      pushQuarantine('presets', '预设库无法解析为 JSON，已整体隔离', presetsRaw);
      parsed = null;
    }
    if (parsed != null && !Array.isArray(parsed)) {
      pushQuarantine('presets', '预设库顶层结构不是数组，已整体隔离', presetsRaw);
    } else if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const result = validatePresetRecord(item);
        if (result.ok) presets.push(result.record);
        else pushQuarantine('presets', result.reason, describe(item));
      }
    }
    // 注意：此处不写回存储。boot 是纯函数（StrictMode 下可能被双调用）；
    // 清洗后的预设库由 App 挂载时的持久化 effect 写回。
  }

  // 工作区快照（刷新恢复）
  let params: Params = { ...DEFAULT_PARAMS };
  let activePresetId: string | null = null;
  const workspaceRaw = readRaw(WORKSPACE_KEY);
  if (workspaceRaw != null) {
    let parsed: unknown = null;
    let parseOk = true;
    try { parsed = JSON.parse(workspaceRaw); }
    catch { parseOk = false; pushQuarantine('workspace', '工作区快照无法解析为 JSON，已恢复默认参数', workspaceRaw); }
    if (parseOk) {
      const w = (parsed ?? null) as Record<string, unknown> | null;
      const version = w?.version;
      if (version !== SCHEMA_VERSION) {
        pushQuarantine('workspace', typeof version === 'number'
          ? `工作区快照为旧版本 v${version}，当前仅支持 v${SCHEMA_VERSION}，已拒绝并恢复默认参数`
          : '工作区快照缺少版本号，已恢复默认参数', workspaceRaw);
      } else if (!isValidParams(w?.params)) {
        pushQuarantine('workspace', '工作区快照参数校验失败，已恢复默认参数', workspaceRaw);
      } else {
        const sp = w.params as Params;
        // 显式重建，只保留四个受管字段
        params = { defect: sp.defect, cells: sp.cells, showBonds: sp.showBonds, planeOpacity: sp.planeOpacity };
        const anchor = w.activePresetId;
        // 锚点预设必须存在于（已清洗的）预设库中，否则视为无锚点的自定义参数
        if (typeof anchor === 'string' && presets.some(p => p.id === anchor)) activePresetId = anchor;
      }
    }
  }

  // 纯函数：不写存储；隔离区的持久化由 App 挂载时的 effect 完成
  return { params, activePresetId, presets, quarantine, newIssues };
}
