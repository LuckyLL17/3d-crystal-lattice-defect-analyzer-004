import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import {
  boot, sameParams, summarizeParams, uid, writeRaw,
  PRESETS_KEY, QUARANTINE_KEY, SCHEMA_VERSION, WORKSPACE_KEY,
} from './presets';
import type { DefectType, Params, PresetRecord, QuarantineEntry } from './presets';

type AtomPoint = { key: string; x: number; y: number; z: number; defect?: 'vacancy' | 'substitution' | 'normal'; };
const colors = { host: '#64c9e1', substitution: '#efb863', vacancy: '#ef7e83', bond: '#4b8190' };

type Toast = { id: number; text: string; tone: 'info' | 'warn' };

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

export default function App() {
  const [initial] = useState(boot);
  const [params, setParams] = useState<Params>(initial.params);
  const [activePresetId, setActivePresetId] = useState<string | null>(initial.activePresetId);
  const [presets, setPresets] = useState<PresetRecord[]>(initial.presets);
  const [quarantine, setQuarantine] = useState<QuarantineEntry[]>(initial.quarantine);
  const [presetName, setPresetName] = useState('');
  const [toast, setToast] = useState<Toast | null>(initial.newIssues.length
    ? { id: 0, tone: 'warn', text: `启动时隔离了 ${initial.newIssues.length} 条损坏或版本过旧的记录，当前参数未受影响` }
    : null);

  // 持久化：预设库与工作区快照分开；刷新后由 boot() 恢复工作区。
  // 预设库 effect 同时承担启动清洗：挂载即把 boot() 过滤后的干净列表写回（损坏记录已进隔离区）。
  useEffect(() => { writeRaw(PRESETS_KEY, JSON.stringify(presets)); }, [presets]);
  useEffect(() => {
    writeRaw(WORKSPACE_KEY, JSON.stringify({ version: SCHEMA_VERSION, params, activePresetId }));
  }, [params, activePresetId]);
  // 启动发现的隔离记录仅在此处落盘一次；之后由清空操作维护
  useEffect(() => {
    if (initial.newIssues.length) writeRaw(QUARANTINE_KEY, JSON.stringify(initial.quarantine));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(timer);
  }, [toast]);

  const activePreset = useMemo(
    () => presets.find(p => p.id === activePresetId) ?? null,
    [presets, activePresetId],
  );
  // 有锚点且与快照完全一致才算已保存；载入后的任何调整立即变为未保存，原预设不动
  const dirty = activePreset ? !sameParams(activePreset.snapshot.params, params) : true;

  const metrics = useMemo(() => ({
    atoms: params.defect === 'vacancy' ? params.cells ** 3 - 1 : params.cells ** 3,
    neighbors: params.defect === 'dislocation' ? '5 / 6' : params.defect === 'vacancy' ? '5 / 6' : '6 / 6',
    strain: params.defect === 'dislocation' ? '8.4%' : params.defect === 'substitution' ? '3.1%' : '1.7%',
  }), [params.cells, params.defect]);

  const notify = (text: string, tone: 'info' | 'warn' = 'info') =>
    setToast({ id: Date.now() + Math.random(), text, tone });
  const patchParams = (patch: Partial<Params>) => setParams(prev => ({ ...prev, ...patch }));

  // 保存只能产生新预设，系统中不存在覆盖 / 回写已存在预设的路径
  function savePreset() {
    const name = presetName.trim();
    if (!name) { notify('请先填写预设名称', 'warn'); return; }
    const record: PresetRecord = {
      id: uid(),
      name,
      createdAt: Date.now(),
      snapshot: { version: SCHEMA_VERSION, params: { ...params } },
    };
    const next = [...presets, record];
    if (!writeRaw(PRESETS_KEY, JSON.stringify(next))) {
      notify('保存失败：浏览器本地存储不可用', 'warn');
      return;
    }
    setPresets(next);
    setActivePresetId(record.id);
    setPresetName('');
    notify(`已另存为新预设「${name}」`);
  }

  // 加载：版本化快照原子替换全部参数（单次状态更新，不做字段合并）
  function loadPreset(record: PresetRecord) {
    setParams({ ...record.snapshot.params });
    setActivePresetId(record.id);
    notify(`已载入预设「${record.name}」，全部参数已按快照替换`);
  }
  function deletePreset(record: PresetRecord) {
    setPresets(prev => prev.filter(p => p.id !== record.id));
    if (activePresetId === record.id) setActivePresetId(null);
    notify(`已删除预设「${record.name}」`);
  }
  function clearQuarantine() {
    writeRaw(QUARANTINE_KEY, JSON.stringify([]));
    setQuarantine([]);
    notify('隔离记录已清空');
  }

  return <div className="app"><header className="topbar"><div className="brand"><div className="brand-icon">◈</div><div><span className="eyebrow">MATERIALS SCIENCE / LATTICE LAB</span><h1>Crystal Defect Lab <span>·</span> 晶格缺陷分析</h1></div></div><div className="header-meta"><span className="sample">SAMPLE / FCC-AL-04</span><button onClick={() => notify('结构快照已准备，可接入数据导出')}>导出快照 ↗</button></div></header><main className="layout"><section className="model-card"><div className="model-head"><div><span className="eyebrow">UNIT CELL EXPLORER</span><h2>面心立方晶格 · 缺陷结构可视化</h2></div><div className="head-stats"><span><b>{params.cells}³</b> 晶胞</span><span><b>{metrics.atoms}</b> 原子</span></div></div><div className="canvas-wrap"><DefectScene cells={params.cells} defect={params.defect} showBonds={params.showBonds} planeOpacity={params.planeOpacity} /><div className="model-legend"><span><i className="dot host" />基体原子</span><span><i className="dot sub" />缺陷原子</span><span><i className="dot line" />滑移/缺陷线</span></div><div className="model-hint">拖拽旋转 · 滚轮缩放 · 三维晶面已叠加</div></div></section><aside className="sidebar"><section className="panel summary"><span className="eyebrow">STRUCTURE SUMMARY</span><h3>晶格参数</h3><div className="summary-grid"><div><span>晶格类型</span><b>FCC</b></div><div><span>晶格常数</span><b>4.05 Å</b></div><div><span>理论密度</span><b>2.70 g/cm³</b></div><div><span>当前温度</span><b>298 K</b></div></div></section><section className="panel"><div className="panel-title"><div><span className="eyebrow">DEFECT LIBRARY</span><h3>缺陷类型</h3></div><span className="count">3 MODELS</span></div><div className="defect-list"><DefectCard type="vacancy" active={params.defect === 'vacancy'} onClick={() => patchParams({ defect: 'vacancy' })} title="空位缺陷" subtitle="原子位置缺失" color={colors.vacancy} /><DefectCard type="substitution" active={params.defect === 'substitution'} onClick={() => patchParams({ defect: 'substitution' })} title="替位缺陷" subtitle="异质原子替换" color={colors.substitution} /><DefectCard type="dislocation" active={params.defect === 'dislocation'} onClick={() => patchParams({ defect: 'dislocation' })} title="刃型位错" subtitle="局部滑移面错位" color="#ef8d86" /></div></section><section className="panel controls"><div className="panel-title"><div><span className="eyebrow">ANALYSIS CONTROLS</span><h3>分析参数</h3></div></div><label>晶胞数量 <output>{params.cells} × {params.cells} × {params.cells}</output><input type="range" min="3" max="5" value={params.cells} onChange={event => patchParams({ cells: Number(event.target.value) })} /></label><label>晶面透明度 <output>{Math.round(params.planeOpacity * 100)}%</output><input type="range" min="0" max=".3" step=".01" value={params.planeOpacity} onChange={event => patchParams({ planeOpacity: Number(event.target.value) })} /></label><button className={params.showBonds ? 'toggle active' : 'toggle'} onClick={() => patchParams({ showBonds: !params.showBonds })}><span className="toggle-dot" />显示最近邻连接</button></section>

<section className="panel presets-panel"><div className="panel-title"><div><span className="eyebrow">LOCAL PRESETS</span><h3>本地预设</h3></div>{activePreset
            ? (dirty ? <span className="preset-badge dirty">未保存</span> : <span className="preset-badge saved">已同步</span>)
            : <span className="preset-badge custom">未命名</span>}</div>
  <div className="preset-status">{activePreset
            ? <>当前基于预设 <b>「{activePreset.name}」</b>{dirty && <em>，参数已修改（原预设不会被改动）</em>}</>
            : <>当前为自定义参数，尚未保存为预设</>}</div>
  <div className="preset-form"><input className="preset-input" value={presetName} placeholder="预设名称，如：讲解-空位 4³" onChange={event => setPresetName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') savePreset(); }} /><button className="preset-save" onClick={savePreset}>保存为新预设</button></div>
  <div className="preset-list">{presets.length === 0 && <div className="preset-empty">暂无预设。调整参数后命名保存，刷新页面也会自动恢复当前工作区。</div>}{presets.map(record => {
            const isActive = record.id === activePresetId;
            const rowDirty = isActive && dirty;
            return <div key={record.id} className={isActive ? 'preset-row active' : 'preset-row'}><div className="preset-info"><span className="preset-name">{record.name}{rowDirty && <i className="dot-dirty" title="有未保存的修改" />}</span><span className="preset-meta">{summarizeParams(record.snapshot.params)}</span><span className="preset-tag">{isActive ? (rowDirty ? '已修改 · 未保存' : '使用中') : `快照 v${record.snapshot.version}`}</span></div><div className="preset-actions"><button className="preset-load" disabled={isActive && !rowDirty} onClick={() => loadPreset(record)}>{isActive && !rowDirty ? '当前' : '载入'}</button><button className="preset-del" title="删除预设" onClick={() => deletePreset(record)}>×</button></div></div>;
          })}</div>
  <p className="preset-foot">载入预设会以版本化快照一次性替换全部参数；之后的调整仅标记为未保存，不会回写原预设，需要保留时请「保存为新预设」。预设仅存储在本机浏览器。</p>
  {quarantine.length > 0 && <div className="quarantine"><div className="quarantine-head"><span>⚠ 已隔离 {quarantine.length} 条损坏或版本过旧的记录（当前参数未受影响）</span><button onClick={clearQuarantine}>清空</button></div><ul>{quarantine.slice(-5).map(entry => <li key={entry.id}><span>{entry.source === 'presets' ? '预设库' : '工作区'} · {new Date(entry.quarantinedAt).toLocaleString()}</span>{entry.reason}</li>)}</ul>{quarantine.length > 5 && <div className="quarantine-more">其余 {quarantine.length - 5} 条已折叠，清空后将一并移除</div>}</div>}
</section>

<section className="panel metrics-panel"><span className="eyebrow">DEFECT METRICS</span><h3>结构指标</h3><div className="metric-row"><div><span>原子数</span><b>{metrics.atoms}</b></div><div><span>平均配位</span><b>{metrics.neighbors}</b></div><div><span>局部应变</span><b>{metrics.strain}</b></div></div><p>指标为演示计算结果，后续可接入真实晶体结构文件与模拟数据。</p></section>{toast && <div className={`toast ${toast.tone === 'warn' ? 'warn' : ''}`} onClick={() => setToast(null)}>{toast.text}<span>×</span></div>}</aside></main></div>;
}
