import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  clearQuarantine,
  countQuarantined,
  createId,
  DEFAULT_SNAPSHOT,
  loadStartup,
  ParamSnapshot,
  persistPresets,
  PresetRecord,
  quarantinePreset,
  saveSession,
  SNAPSHOT_VERSION,
  validateSnapshot,
} from './presets';

type DefectType = ParamSnapshot['defect'];
type AtomPoint = { key: string; x: number; y: number; z: number; defect?: 'vacancy' | 'substitution' | 'normal'; };
const colors = { host: '#64c9e1', substitution: '#efb863', vacancy: '#ef7e83', bond: '#4b8190' };
const defectLabels: Record<DefectType, string> = { vacancy: '空位', substitution: '替位', dislocation: '刃型位错' };
function buildAtoms(cells: number, defect: DefectType): AtomPoint[] {
  const atoms: AtomPoint[] = [];
  for (let x = 0; x < cells; x += 1) for (let y = 0; y < cells; y += 1) for (let z = 0; z < cells; z += 1) {
    const key = `${x}-${y}-${z}`;
    if (defect === 'vacancy' && x === 1 && y === 1 && z === 1) continue;
    if (defect === 'substitution' && x === 1 && y === 1 && z === 1) atoms.push({ key, x, y, z, defect: 'substitution' });
    else atoms.push({ key, x, y, z, defect: 'normal' });
  }
  if (defect === 'dislocation') return atoms.filter(atom => !(atom.x === 2 && atom.y === 0 && atom.z === 2));
  return atoms;
}
function DefectScene({ cells, defect, showBonds, planeOpacity }: { cells: number; defect: DefectType; showBonds: boolean; planeOpacity: number }) {
  const atoms = useMemo(() => buildAtoms(cells, defect), [cells, defect]);
  const points = useMemo(() => atoms.map(atom => new THREE.Vector3((atom.x - (cells - 1) / 2) * 1.25, (atom.y - (cells - 1) / 2) * 1.25, (atom.z - (cells - 1) / 2) * 1.25)), [atoms, cells]);
  const bonds = useMemo(() => { const list: [THREE.Vector3, THREE.Vector3][] = []; atoms.forEach(atom => { const origin = new THREE.Vector3((atom.x - (cells - 1) / 2) * 1.25, (atom.y - (cells - 1) / 2) * 1.25, (atom.z - (cells - 1) / 2) * 1.25); const neighbor = atoms.find(item => item.x === atom.x + 1 && item.y === atom.y && item.z === atom.z); if (neighbor) list.push([origin, new THREE.Vector3((neighbor.x - (cells - 1) / 2) * 1.25, (neighbor.y - (cells - 1) / 2) * 1.25, (neighbor.z - (cells - 1) / 2) * 1.25)]); const zNeighbor = atoms.find(item => item.x === atom.x && item.y === atom.y && item.z === atom.z + 1); if (zNeighbor) list.push([origin, new THREE.Vector3((zNeighbor.x - (cells - 1) / 2) * 1.25, (zNeighbor.y - (cells - 1) / 2) * 1.25, (zNeighbor.z - (cells - 1) / 2) * 1.25)]); }); return list; }, [atoms, cells]);
  return <Canvas shadows camera={{ position: [8, 6, 8], fov: 38 }}><color attach="background" args={['#09151d']} /><ambientLight intensity={1.25} /><directionalLight position={[5, 8, 5]} intensity={2.3} castShadow /><pointLight position={[-4, 2, 3]} color="#5fd4ee" intensity={12} distance={12} /><group rotation={[.15, -.35, 0]}>{showBonds && bonds.map((bond, index) => <Line key={index} points={bond} color={colors.bond} lineWidth={1.2} transparent opacity={.65} />)}{atoms.map(atom => { const position = [(atom.x - (cells - 1) / 2) * 1.25, (atom.y - (cells - 1) / 2) * 1.25, (atom.z - (cells - 1) / 2) * 1.25] as [number, number, number]; const color = atom.defect === 'substitution' ? colors.substitution : colors.host; return <mesh key={atom.key} position={position} castShadow><sphereGeometry args={[atom.defect === 'substitution' ? .3 : .2, 18, 12]} /><meshStandardMaterial color={color} emissive={atom.defect === 'substitution' ? colors.substitution : '#000'} emissiveIntensity={atom.defect === 'substitution' ? .35 : 0} /></mesh>; })}{defect === 'vacancy' && <mesh position={[0, 0, 0]}><sphereGeometry args={[.35, 16, 12]} /><meshBasicMaterial color={colors.vacancy} transparent opacity={.26} wireframe /></mesh>}{defect === 'dislocation' && <Line points={[new THREE.Vector3(-1.9, -1.9, 0), new THREE.Vector3(-.65, -1.9, 0), new THREE.Vector3(-.65, -.65, 0), new THREE.Vector3(.65, -.65, 0), new THREE.Vector3(.65, .65, 0), new THREE.Vector3(1.9, .65, 0)]} color="#f08d87" lineWidth={4} />}</group><mesh rotation={[0, 0, 0]} position={[0, 0, 0]}><planeGeometry args={[5.6, 5.6]} /><meshBasicMaterial color="#69cde2" transparent opacity={planeOpacity} side={THREE.DoubleSide} /></mesh><Grid args={[8, 8]} cellSize={1.25} sectionSize={2.5} cellColor="#326778" sectionColor="#72b9c9" position={[0, -2.55, 0]} /><OrbitControls makeDefault minDistance={5} maxDistance={15} /></Canvas>;
}
function DefectCard({ type, active, onClick, title, subtitle, color }: { type: DefectType; active: boolean; onClick: () => void; title: string; subtitle: string; color: string }) { return <button className={active ? 'defect-card active' : 'defect-card'} onClick={onClick}><span className="defect-symbol" style={{ color }}>{type === 'vacancy' ? '○' : type === 'substitution' ? '◉' : '∿'}</span><span><b>{title}</b><small>{subtitle}</small></span><i>{active ? 'ACTIVE' : 'SELECT'}</i></button>; }

interface Toast { id: number; kind: 'info' | 'warn' | 'error'; text: string; }

export default function App() {
  // 启动时一次性读取：预设库、隔离记录、刷新前的会话快照。
  const startup = useRef(loadStartup());
  const [params, setParams] = useState<ParamSnapshot>(() => startup.current.restored?.snapshot ?? DEFAULT_SNAPSHOT);
  const [activePresetId, setActivePresetId] = useState<string | null>(() => startup.current.restored?.activePresetId ?? null);
  const [dirty, setDirty] = useState<boolean>(() => startup.current.restored?.dirty ?? false);
  const [presets, setPresets] = useState<PresetRecord[]>(() => startup.current.store.presets);
  const [quarantineCount, setQuarantineCount] = useState(() => startup.current.quarantined.length);
  const [presetName, setPresetName] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const hydrated = useRef(false);

  const pushToast = (text: string, kind: Toast['kind'] = 'info') => {
    const id = (toastSeq.current += 1);
    setToasts(list => [...list, { id, kind, text }]);
    window.setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), 4200);
  };
  const dismissToast = (id: number) => setToasts(list => list.filter(item => item.id !== id));

  // 启动提示：会话旧版本/损坏、本地存储不可用。
  useEffect(() => {
    if (startup.current.restoredIssue) pushToast(startup.current.restoredIssue, 'warn');
  }, []);

  const { cells, defect, showBonds, planeOpacity } = params;
  const metrics = useMemo(() => ({ atoms: defect === 'vacancy' ? cells ** 3 - 1 : cells ** 3, neighbors: defect === 'dislocation' ? '5 / 6' : defect === 'vacancy' ? '5 / 6' : '6 / 6', strain: defect === 'dislocation' ? '8.4%' : defect === 'substitution' ? '3.1%' : '1.7%' }), [cells, defect]);

  // 修改参数只更新工作副本：已加载预设时仅标记未保存，绝不回写原预设。
  const updateParams = (patch: Partial<Omit<ParamSnapshot, 'version'>>) => {
    setParams(prev => ({ ...prev, ...patch }));
    setDirty(true);
  };

  // 原子加载：校验通过后一次性替换全部参数；旧版本拒绝，损坏记录隔离。
  const loadPreset = (id: string) => {
    const target = presets.find(item => item.id === id);
    if (!target) return;
    let snapshot: ParamSnapshot;
    try {
      snapshot = validateSnapshot(target.snapshot);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '快照无效';
      const next = quarantinePreset(presets, id, reason);
      setPresets(next);
      try { persistPresets(next); } catch { /* 内存模式 */ }
      setQuarantineCount(countQuarantined());
      if (activePresetId === id) setActivePresetId(null);
      pushToast(/旧版本/.test(reason) ? `预设「${target.name}」为旧版本，已拒绝加载并隔离` : `预设「${target.name}」已损坏，已隔离`, 'error');
      return;
    }
    setParams(snapshot);
    setActivePresetId(id);
    setDirty(false);
    pushToast(`已加载预设「${target.name}」`);
  };

  // 保存始终创建新预设，从不覆盖任何既有预设。
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) { pushToast('请填写预设名称', 'warn'); return; }
    const record: PresetRecord = { id: createId(), name, createdAt: Date.now(), snapshot: { ...params } };
    const next = [...presets, record];
    try {
      persistPresets(next);
    } catch {
      pushToast('本地存储不可用，预设仅在本次页面有效', 'error');
    }
    setPresets(next);
    setActivePresetId(record.id);
    setDirty(false);
    setPresetName('');
    pushToast(`已保存预设「${name}」`);
  };

  const deletePreset = (id: string) => {
    const target = presets.find(item => item.id === id);
    const next = presets.filter(item => item.id !== id);
    try { persistPresets(next); } catch { /* 内存模式 */ }
    setPresets(next);
    if (activePresetId === id) { setActivePresetId(null); setDirty(false); }
    if (target) pushToast(`已删除预设「${target.name}」`);
  };

  const discardQuarantine = () => {
    clearQuarantine();
    setQuarantineCount(0);
    pushToast('已清空隔离记录');
  };

  // 刷新恢复：参数/活动预设/未保存标记自动写入会话槽（防抖 + 关闭页面前冲刷）。
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; }
    const timer = window.setTimeout(() => {
      try { saveSession({ snapshot: params, activePresetId, dirty }); } catch { /* 忽略 */ }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [params, activePresetId, dirty]);
  useEffect(() => {
    const flush = () => { try { saveSession({ snapshot: params, activePresetId, dirty }); } catch { /* 忽略 */ } };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => { window.removeEventListener('beforeunload', flush); document.removeEventListener('visibilitychange', flush); };
  }, [params, activePresetId, dirty]);

  const activePreset = activePresetId ? presets.find(item => item.id === activePresetId) : undefined;
  const statusText = activePreset
    ? `${activePreset.name}${dirty ? ' · 未保存修改' : ''}`
    : `${dirty ? '自定义参数 · 未保存修改' : '默认参数'}`;

  return <div className="app"><header className="topbar"><div className="brand"><div className="brand-icon">◈</div><div><span className="eyebrow">MATERIALS SCIENCE / LATTICE LAB</span><h1>Crystal Defect Lab <span>·</span> 晶格缺陷分析</h1></div></div><div className="header-meta"><span className="sample">SAMPLE / FCC-AL-04</span><button onClick={() => pushToast('结构快照已准备，可接入数据导出')}>导出快照 ↗</button></div></header><main className="layout"><section className="model-card"><div className="model-head"><div><span className="eyebrow">UNIT CELL EXPLORER</span><h2>面心立方晶格 · 缺陷结构可视化</h2></div><div className="head-stats"><span><b>{cells}³</b> 晶胞</span><span><b>{metrics.atoms}</b> 原子</span></div></div><div className="canvas-wrap"><DefectScene cells={cells} defect={defect} showBonds={showBonds} planeOpacity={planeOpacity} /><div className="model-legend"><span><i className="dot host" />基体原子</span><span><i className="dot sub" />缺陷原子</span><span><i className="dot line" />滑移/缺陷线</span></div><div className="model-hint">拖拽旋转 · 滚轮缩放 · 三维晶面已叠加</div></div></section><aside className="sidebar">{quarantineCount > 0 && <div className="quarantine-banner"><b>检测到 {quarantineCount} 条损坏/旧版本记录，已隔离</b><span>这些预设不会被加载。<button onClick={discardQuarantine}>清除隔离记录</button></span></div>}<section className="panel summary"><span className="eyebrow">STRUCTURE SUMMARY</span><h3>晶格参数</h3><div className="summary-grid"><div><span>晶格类型</span><b>FCC</b></div><div><span>晶格常数</span><b>4.05 Å</b></div><div><span>理论密度</span><b>2.70 g/cm³</b></div><div><span>当前温度</span><b>298 K</b></div></div></section><section className="panel"><div className="panel-title"><div><span className="eyebrow">DEFECT LIBRARY</span><h3>缺陷类型</h3></div><span className="count">3 MODELS</span></div><div className="defect-list"><DefectCard type="vacancy" active={defect === 'vacancy'} onClick={() => updateParams({ defect: 'vacancy' })} title="空位缺陷" subtitle="原子位置缺失" color={colors.vacancy} /><DefectCard type="substitution" active={defect === 'substitution'} onClick={() => updateParams({ defect: 'substitution' })} title="替位缺陷" subtitle="异质原子替换" color={colors.substitution} /><DefectCard type="dislocation" active={defect === 'dislocation'} onClick={() => updateParams({ defect: 'dislocation' })} title="刃型位错" subtitle="局部滑移面错位" color="#ef8d86" /></div></section><section className="panel controls"><div className="panel-title"><div><span className="eyebrow">ANALYSIS CONTROLS</span><h3>分析参数</h3></div></div><label>晶胞数量 <output>{cells} × {cells} × {cells}</output><input type="range" min="3" max="5" value={cells} onChange={event => updateParams({ cells: Number(event.target.value) })} /></label><label>晶面透明度 <output>{Math.round(planeOpacity * 100)}%</output><input type="range" min="0" max=".3" step=".01" value={planeOpacity} onChange={event => updateParams({ planeOpacity: Number(event.target.value) })} /></label><button className={showBonds ? 'toggle active' : 'toggle'} onClick={() => updateParams({ showBonds: !showBonds })}><span className="toggle-dot" />显示最近邻连接</button></section><section className="panel presets-panel"><div className="panel-title"><div><span className="eyebrow">LOCAL PRESETS · V{SNAPSHOT_VERSION}</span><h3>参数预设</h3></div><span className={dirty && activePresetId ? 'preset-status dirty' : 'preset-status'}>{statusText}{dirty && activePresetId && <i className="unsaved-dot" />}</span></div>{presets.length === 0 ? <p className="preset-empty">暂无本地预设，调整参数后在下方保存。</p> : <div className="preset-list">{presets.map(item => <div key={item.id} className={item.id === activePresetId ? 'preset-row active' : 'preset-row'}><button className="preset-load" title="原子替换全部参数" onClick={() => loadPreset(item.id)}><b>{item.name}</b><small>{defectLabels[item.snapshot.defect]} · {item.snapshot.cells}³ · 透明度 {Math.round(item.snapshot.planeOpacity * 100)}% · 连接线 {item.snapshot.showBonds ? '开' : '关'}</small></button><button className="preset-del" title="删除预设" onClick={() => deletePreset(item.id)}>×</button></div>)}</div>}<div className="preset-save"><input value={presetName} onChange={event => setPresetName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') savePreset(); }} placeholder="预设名称，如：空位·4晶胞·高透明" maxLength={30} /><button onClick={savePreset}>保存为新预设</button></div><p className="preset-note">加载会整体替换当前参数；加载后的修改只标记未保存，不会回写原预设。参数会在刷新后自动恢复。</p></section><section className="panel metrics-panel"><span className="eyebrow">DEFECT METRICS</span><h3>结构指标</h3><div className="metric-row"><div><span>原子数</span><b>{metrics.atoms}</b></div><div><span>平均配位</span><b>{metrics.neighbors}</b></div><div><span>局部应变</span><b>{metrics.strain}</b></div></div><p>指标为演示计算结果，后续可接入真实晶体结构文件与模拟数据。</p></section></aside></main><div className="toast-stack">{toasts.map(toast => <div key={toast.id} className={`toast ${toast.kind}`} onClick={() => dismissToast(toast.id)}>{toast.text}<span>×</span></div>)}</div></div>;
}
