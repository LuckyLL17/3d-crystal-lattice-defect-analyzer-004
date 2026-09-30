// 预设模块端到端测试：内存存储后端，不依赖浏览器 / URL。
import assert from 'node:assert/strict';
import {
  boot, setStoreBackend, writeRaw, readRaw, validatePresetRecord, sameParams,
  isValidParams, PRESETS_KEY, WORKSPACE_KEY, QUARANTINE_KEY, DEFAULT_PARAMS, SCHEMA_VERSION,
} from './presets.js';

let store;
function reset() {
  store = new Map();
  setStoreBackend({ getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, v) });
}
// 模拟 App 挂载：boot() 是纯函数，清洗后的预设库与新隔离记录由持久化 effect 落盘
function bootWithPersistence() {
  const result = boot();
  writeRaw(PRESETS_KEY, JSON.stringify(result.presets));
  if (result.newIssues.length) writeRaw(QUARANTINE_KEY, JSON.stringify(result.quarantine));
  return result;
}
const paramsA = { defect: 'dislocation', cells: 5, showBonds: false, planeOpacity: 0.2 };
const presetA = (id = 'p1', name = '讲解-位错') => ({ id, name, createdAt: 1, snapshot: { version: 1, params: { ...paramsA } } });

// 1. 空存储 → 默认参数
reset();
let r = boot();
assert.deepEqual(r.params, DEFAULT_PARAMS);
assert.equal(r.activePresetId, null);
assert.deepEqual(r.presets, []);
assert.equal(r.newIssues.length, 0);
console.log('1 ok  空存储恢复默认参数');

// 2. 保存预设 + 工作区锚点 → 刷新后完整恢复（原子替换）
reset();
writeRaw(PRESETS_KEY, JSON.stringify([presetA()]));
writeRaw(WORKSPACE_KEY, JSON.stringify({ version: 1, params: { ...paramsA }, activePresetId: 'p1' }));
r = boot();
assert.deepEqual(r.params, paramsA);
assert.equal(r.activePresetId, 'p1');
assert.equal(r.presets.length, 1);
assert.equal(r.newIssues.length, 0);
console.log('2 ok  刷新恢复工作区参数与预设锚点');

// 3. 旧版本预设被拒绝（不迁移）、隔离，正常预设保留
reset();
writeRaw(PRESETS_KEY, JSON.stringify([
  presetA(),
  { id: 'old', name: '旧版预设', createdAt: 0, snapshot: { version: 0, params: { ...DEFAULT_PARAMS } } },
]));
r = bootWithPersistence();
assert.equal(r.presets.length, 1, '只保留 v1 预设');
assert.equal(r.presets[0].id, 'p1');
assert.equal(r.quarantine.length, 1);
assert.match(r.quarantine[0].reason, /版本/);
assert.match(r.newIssues[0], /旧版预设/);
// 预设库已被清洗写回（损坏内容不留在原键）
assert.equal(JSON.parse(readRaw(PRESETS_KEY)).length, 1);
console.log('3 ok  拒绝旧版本并隔离，清洗预设库');

// 4. 参数越界 / 类型错误的 v1 记录被隔离
reset();
writeRaw(PRESETS_KEY, JSON.stringify([
  presetA(),
  { id: 'bad1', name: '越界', createdAt: 0, snapshot: { version: 1, params: { ...DEFAULT_PARAMS, cells: 9 } } },
  { id: 'bad2', name: '透明度越界', createdAt: 0, snapshot: { version: 1, params: { ...DEFAULT_PARAMS, planeOpacity: 1 } } },
  { id: 'bad3', name: '缺字段', createdAt: 0, snapshot: { version: 1, params: { defect: 'vacancy' } } },
  { id: 'bad4', name: '无快照', createdAt: 0 },
  { garbage: true },
]));
r = bootWithPersistence();
assert.equal(r.presets.length, 1);
assert.equal(r.quarantine.length, 5);
console.log('4 ok  损坏/越界记录逐条隔离');

// 5. 预设库整体不是合法 JSON / 不是数组 → 整体隔离，不拖垮启动
reset();
writeRaw(PRESETS_KEY, '{not json');
r = bootWithPersistence();
assert.deepEqual(r.presets, []);
assert.equal(r.quarantine.length, 1);
assert.match(r.quarantine[0].reason, /JSON/);
assert.deepEqual(r.params, DEFAULT_PARAMS, '当前参数不受影响');

reset();
writeRaw(PRESETS_KEY, JSON.stringify({ not: 'an array' }));
r = bootWithPersistence();
assert.deepEqual(r.presets, []);
assert.equal(r.quarantine.length, 1);
assert.match(r.quarantine[0].reason, /数组/);
console.log('5 ok  预设库整体损坏时隔离且不影响当前参数');

// 6. 工作区快照：旧版本拒绝 → 默认参数 + 隔离
reset();
writeRaw(PRESETS_KEY, JSON.stringify([presetA()]));
writeRaw(WORKSPACE_KEY, JSON.stringify({ version: 0, params: { ...paramsA }, activePresetId: 'p1' }));
r = bootWithPersistence();
assert.deepEqual(r.params, DEFAULT_PARAMS);
assert.equal(r.activePresetId, null);
assert.ok(r.quarantine.some(e => e.source === 'workspace' && /旧版本/.test(e.reason)));
assert.equal(r.presets.length, 1, '预设库本身不受工作区损坏影响');

reset();
writeRaw(WORKSPACE_KEY, 'workspace-broken');
r = bootWithPersistence();
assert.deepEqual(r.params, DEFAULT_PARAMS);
assert.ok(r.quarantine.some(e => e.source === 'workspace' && /JSON/.test(e.reason)));
console.log('6 ok  工作区旧版本/损坏被拒绝并提示');

// 7. 工作区锚点指向不存在的预设 → 视为自定义参数，锚点置空
reset();
writeRaw(PRESETS_KEY, JSON.stringify([presetA()]));
writeRaw(WORKSPACE_KEY, JSON.stringify({ version: 1, params: { ...paramsA }, activePresetId: 'ghost' }));
r = boot();
assert.deepEqual(r.params, paramsA);
assert.equal(r.activePresetId, null);
assert.equal(r.quarantine.length, 0, '锚点失效不算损坏，不隔离');
console.log('7 ok  失效锚点安全降级为自定义参数');

// 8. 载入快照后修改参数，再走"工作区持久化+刷新"循环：原预设不被回写
reset();
writeRaw(PRESETS_KEY, JSON.stringify([presetA()]));
writeRaw(WORKSPACE_KEY, JSON.stringify({ version: 1, params: { ...paramsA }, activePresetId: 'p1' }));
bootWithPersistence();
// 模拟 App 的加载后编辑：整体替换工作区 params（dirty），预设库不应被触碰
const edited = { ...paramsA, cells: 3 };
writeRaw(WORKSPACE_KEY, JSON.stringify({ version: SCHEMA_VERSION, params: edited, activePresetId: 'p1' }));
r = bootWithPersistence();
assert.deepEqual(r.params, edited, '刷新后恢复的是编辑后的工作区');
const storedPreset = JSON.parse(readRaw(PRESETS_KEY))[0];
assert.deepEqual(storedPreset.snapshot.params, paramsA, '原预设快照保持不变（不回写）');
assert.equal(r.activePresetId, 'p1');
assert.ok(!sameParams(r.presets[0].snapshot.params, r.params), 'dirty 判定成立');
console.log('8 ok  载入后修改仅作用于工作区，原预设不回写');

// 9. 校验函数只重建干净对象，不穿透额外字段
reset();
const evil = { id: 'x', name: 'n', createdAt: 2, extra: 'drop', snapshot: { version: 1, params: { ...DEFAULT_PARAMS, injected: 1 } } };
const vr = validatePresetRecord(evil);
assert.equal(vr.ok, true);
assert.deepEqual(Object.keys(vr.record.snapshot).sort(), ['params', 'version']);
assert.deepEqual(vr.record.snapshot.params, DEFAULT_PARAMS);
assert.equal(undefined, vr.record.extra);
console.log('9 ok  快照重建去除额外字段');

// 10. 首次启动隔离损坏记录并（由 effect）落盘；之后刷新不再提示、不堆积
reset();
writeRaw(PRESETS_KEY, JSON.stringify([{ id: 'old', name: 'o', snapshot: { version: 0, params: {} } }]));
r = bootWithPersistence();
assert.equal(r.quarantine.length, 1);
assert.equal(r.newIssues.length, 1, '首次启动报告 1 条新问题');
// 模拟刷新：预设库已清洗、隔离区已落盘
r = bootWithPersistence();
assert.equal(r.quarantine.length, 1, '隔离记录不堆积');
assert.equal(r.newIssues.length, 0, '后续刷新不再作为新问题提示');
assert.equal(JSON.parse(readRaw(PRESETS_KEY)).length, 0);
console.log('10 ok 隔离落盘后刷新不再重复提示');

// 11. 隔离区自身损坏 → 忽略损坏隔离文件，主流程仍正常
reset();
writeRaw(QUARANTINE_KEY, 'quar-broken');
writeRaw(PRESETS_KEY, JSON.stringify([presetA()]));
r = bootWithPersistence();
assert.equal(r.presets.length, 1);
assert.deepEqual(r.params, DEFAULT_PARAMS);
console.log('11 ok 隔离区损坏不影响启动');

// 12. 基础校验边界
assert.ok(isValidParams(DEFAULT_PARAMS));
assert.ok(!isValidParams(null));
assert.ok(!isValidParams({ ...DEFAULT_PARAMS, cells: 2.5 }));
assert.ok(!isValidParams({ ...DEFAULT_PARAMS, defect: 'x' }));
assert.ok(!isValidParams({ ...DEFAULT_PARAMS, showBonds: 'yes' }));
console.log('12 ok 参数校验边界');

console.log('\n全部测试通过 ✅（共 12 组）');
