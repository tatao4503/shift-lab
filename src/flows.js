function fail(message) { throw new Error(message); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
const FIELDS = ['out', 'in', 'renumbered', 'movedOut', 'movedIn'];

export const MATCHING = Object.freeze({
  identity: '상가업소번호',
  renumbered: '같은 행정동·같은 소분류 안에서 상호명과 도로명주소가 모두 같으면 번호만 바뀐 것으로 보고 남은 점포로 센다',
});

/**
 * 두 기준일의 점포를 상가업소번호로 맞춰, 행정동·소분류 칸마다 빠진 곳과 새로 수록된 곳을 센다.
 * stores는 [번호, 행정동코드, 소분류코드, 상호명, 도로명주소]의 배열이다(ingestStores의 collectStores).
 *
 * - 같은 번호가 같은 칸에 있으면 남은 것이다.
 * - 같은 번호가 다른 칸에 있으면 앞 칸에서는 빠진 것(movedOut), 뒤 칸에서는 새로 수록된 것(movedIn)이다.
 * - 번호가 사라졌어도 같은 칸에 같은 상호·같은 도로명주소의 새 번호가 있으면 번호만 바뀐 것(renumbered)으로 보고 남은 것으로 센다.
 * 빠짐은 폐업이 아니고 새로 수록은 개업이 아니다. 이전, 재분류, 원천의 정비가 섞인다.
 */
export function computeFlows(previousStores, currentStores) {
  const index = stores => {
    const map = new Map();
    for (const [id, admCode, category, name, address] of stores) {
      if (map.has(id)) fail('같은 상가업소번호가 한 기준일에 두 번 있습니다.');
      map.set(id, { cell: `${admCode}:${category}`, key: name && address ? `${name}\u0000${address}` : null });
    }
    return map;
  };
  const previous = index(previousStores); const current = index(currentStores);
  const cells = new Map();
  const cell = key => { if (!cells.has(key)) cells.set(key, { out: 0, in: 0, renumbered: 0, movedOut: 0, movedIn: 0 }); return cells.get(key); };
  const gone = new Map(); const added = new Map();
  const tally = (bucket, cellKey, key) => {
    if (!bucket.has(cellKey)) bucket.set(cellKey, { total: 0, keys: new Map() });
    const entry = bucket.get(cellKey); entry.total += 1;
    if (key !== null) entry.keys.set(key, (entry.keys.get(key) || 0) + 1);
  };
  const totals = { keptSameId: 0, renumbered: 0, moved: 0, gone: 0, added: 0 };
  for (const [id, before] of previous) {
    const after = current.get(id);
    if (!after) tally(gone, before.cell, before.key);
    else if (after.cell === before.cell) totals.keptSameId += 1;
    else { cell(before.cell).out += 1; cell(before.cell).movedOut += 1; cell(after.cell).in += 1; cell(after.cell).movedIn += 1; totals.moved += 1; }
  }
  for (const [id, after] of current) if (!previous.has(id)) tally(added, after.cell, after.key);
  for (const cellKey of new Set([...gone.keys(), ...added.keys()])) {
    const left = gone.get(cellKey) || { total: 0, keys: new Map() }; const arrived = added.get(cellKey) || { total: 0, keys: new Map() };
    let matched = 0;
    for (const [key, count] of left.keys) matched += Math.min(count, arrived.keys.get(key) || 0);
    const entry = cell(cellKey);
    entry.renumbered += matched; entry.out += left.total - matched; entry.in += arrived.total - matched;
    totals.renumbered += matched; totals.gone += left.total - matched; totals.added += arrived.total - matched;
  }
  return { cells, totals, previousRows: previous.size, currentRows: current.size };
}

/** 색인과 같은 소분류 순서로, 값이 있는 칸만 적은 파일 모양을 만든다. */
export function buildFlowsFile({ kind, previous, current, categories, flows }) {
  const positions = new Map(categories.map((code, position) => [code, position]));
  const dongs = new Map();
  for (const [key, value] of flows.cells) {
    if (FIELDS.every(field => value[field] === 0)) continue;
    const [admCode, category] = key.split(':');
    if (!positions.has(category)) fail('색인에 없는 소분류의 점포가 있습니다.');
    if (!dongs.has(admCode)) dongs.set(admCode, []);
    dongs.get(admCode).push([positions.get(category), ...FIELDS.map(field => value[field])]);
  }
  return { schemaVersion: 1, kind, previous, current, matching: { ...MATCHING }, totals: { ...flows.totals }, categories: [...categories],
    dongs: [...dongs].sort(([a], [b]) => a.localeCompare(b)).map(([admCode, cells]) => ({ admCode, cells: cells.sort((a, b) => a[0] - b[0]) })) };
}

/**
 * 드나듦 파일이 두 색인과 맞는지 확인한다. 모든 행정동·소분류 칸에서
 * (이전 수 − 빠짐) = (지금 수 − 새로 수록) = 남은 수 가 성립해야 한다. 하나라도 어긋나면 쓰지 않는다.
 */
export function validateFlows(input, currentIndex, previousIndex) {
  if (!object(input) || input.schemaVersion !== 1) fail('지원하는 드나듦 자료 형식은 schemaVersion 1입니다.');
  if (input.kind !== currentIndex.kind || input.kind !== previousIndex.kind) fail('드나듦 자료와 색인의 자료 구분이 다릅니다.');
  for (const [side, index] of [['previous', previousIndex], ['current', currentIndex]]) {
    const meta = input[side];
    if (!object(meta) || meta.asOf !== index.source.asOf || meta.sha256 !== index.source.sha256 || meta.sourceRows !== index.analysis.sourceRows) fail('드나듦 자료의 기준일·원본 해시·행수가 색인과 다릅니다.');
  }
  if (!object(input.matching) || input.matching.identity !== MATCHING.identity || input.matching.renumbered !== MATCHING.renumbered) fail('드나듦 자료의 대조 규칙이 이 앱의 규칙과 다릅니다.');
  const codes = currentIndex.categories.map(category => category.code);
  if (!Array.isArray(input.categories) || input.categories.length !== codes.length || input.categories.some((code, position) => code !== codes[position])
    || previousIndex.categories.length !== codes.length || previousIndex.categories.some((category, position) => category.code !== codes[position])) fail('드나듦 자료와 두 색인의 소분류 순서가 같아야 합니다.');
  if (!Array.isArray(input.dongs)) fail('드나듦 자료에 행정동 목록이 필요합니다.');
  const table = new Map();
  for (const dong of input.dongs) {
    if (!object(dong) || typeof dong.admCode !== 'string' || table.has(dong.admCode) || !Array.isArray(dong.cells)) fail('드나듦 자료의 행정동이 잘못되었거나 겹칩니다.');
    const cells = new Map();
    for (const row of dong.cells) {
      if (!Array.isArray(row) || row.length !== FIELDS.length + 1 || row.some(value => !Number.isSafeInteger(value) || value < 0) || row[0] >= codes.length || cells.has(row[0])) fail('드나듦 자료의 칸이 잘못되었거나 겹칩니다.');
      const entry = Object.fromEntries(FIELDS.map((field, position) => [field, row[position + 1]]));
      if (entry.movedOut > entry.out || entry.movedIn > entry.in) fail('옮겨 수록된 수가 빠짐·새로 수록보다 큽니다.');
      cells.set(row[0], entry);
    }
    table.set(dong.admCode, cells);
  }
  const previousDongs = new Map(previousIndex.dongs.map(dong => [dong.admCode, dong]));
  const currentDongs = new Map(currentIndex.dongs.map(dong => [dong.admCode, dong]));
  for (const admCode of table.keys()) if (!previousDongs.has(admCode) && !currentDongs.has(admCode)) fail('드나듦 자료에 두 색인 어디에도 없는 행정동이 있습니다.');
  const zeros = codes.map(() => 0);
  for (const admCode of new Set([...previousDongs.keys(), ...currentDongs.keys()])) {
    const before = previousDongs.get(admCode)?.counts || zeros; const after = currentDongs.get(admCode)?.counts || zeros;
    const cells = table.get(admCode);
    for (let position = 0; position < codes.length; position += 1) {
      const entry = cells?.get(position);
      const kept = before[position] - (entry ? entry.out : 0);
      if (kept < 0 || kept !== after[position] - (entry ? entry.in : 0)) fail('드나듦 자료가 색인의 점포 수와 맞지 않습니다. (이전 수 − 빠짐)과 (지금 수 − 새로 수록)이 같아야 합니다.');
      if (entry && entry.renumbered > kept) fail('번호만 바뀐 수가 남은 수보다 큽니다.');
    }
  }
  const totals = Object.fromEntries(['keptSameId', 'renumbered', 'moved', 'gone', 'added'].map(key => {
    if (!object(input.totals) || !Number.isSafeInteger(input.totals[key]) || input.totals[key] < 0) fail('드나듦 자료의 합계가 필요합니다.');
    return [key, input.totals[key]];
  }));
  if (totals.keptSameId + totals.moved + totals.renumbered + totals.gone !== previousIndex.analysis.sourceRows
    || totals.keptSameId + totals.moved + totals.renumbered + totals.added !== currentIndex.analysis.sourceRows) fail('드나듦 자료의 합계가 두 기준일의 원천 행수와 맞지 않습니다.');
  return { schemaVersion: 1, kind: input.kind, previous: { ...input.previous }, current: { ...input.current }, matching: { ...MATCHING }, totals, categories: codes, table };
}

/** 고른 행정동·소분류 칸의 드나듦. 남은 수는 이전 수에서 빠짐을 뺀 값이다. */
export function cellFlow(flows, previousIndex, admCode, categoryCode) {
  const position = flows.categories.indexOf(categoryCode);
  if (position < 0) fail('드나듦 자료에 없는 업종입니다.');
  const before = previousIndex.dongs.find(dong => dong.admCode === admCode);
  if (!before) return null;
  const entry = flows.table.get(admCode)?.get(position) || { out: 0, in: 0, renumbered: 0, movedOut: 0, movedIn: 0 };
  return { kept: before.counts[position] - entry.out, ...entry };
}
