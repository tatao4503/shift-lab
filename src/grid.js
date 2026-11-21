function fail(message) { throw new Error(message); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

/** 대구 위도에서 경위도 1도를 미터로 바꾸는 근사값. 측량용이 아니라 약 100m 칸으로 묶는 데만 쓴다. */
export const PROJECTION = Object.freeze({ latitudeMeters: 110900, longitudeMeters: 90200, note: '대구 위도(북위 35.9도 부근)의 평면 근사' });
export const CELL_METERS = 100;
/** 색 단계는 고정이다. 어느 동·어느 업종이든 같은 색이 같은 수를 뜻한다. */
export const BINS = Object.freeze([{ min: 1, max: 1, label: '1곳' }, { min: 2, max: 2, label: '2곳' }, { min: 3, max: 4, label: '3~4곳' }, { min: 5, max: 9, label: '5~9곳' }, { min: 10, max: Infinity, label: '10곳 이상' }]);
export function binOf(count) { return BINS.findIndex(bin => count >= bin.min && count <= bin.max); }

export function cellOf(longitude, latitude, meters = CELL_METERS) {
  return [Math.floor(longitude * PROJECTION.longitudeMeters / meters), Math.floor(latitude * PROJECTION.latitudeMeters / meters)];
}

/** '대구광역시 중구 동성로6길' → '동성로6길'. 시·구군 이름은 화면의 다른 곳에 이미 있다. */
export function roadLabel(road) {
  const parts = String(road).trim().split(/\s+/);
  return parts.length > 2 ? parts.slice(2).join(' ') : parts.join(' ');
}

/**
 * 점포 좌표를 행정동마다 약 100m 칸으로 묶어 센다. points는 [행정동코드, 소분류코드, 경도, 위도, 도로명]의 배열이다.
 * 결과에는 칸의 위치, 칸 안 전체 점포 수, 가장 흔한 도로명, 소분류별 수만 남는다. 점포 좌표·번호·상호는 남기지 않는다.
 */
export function buildDongGrids(points) {
  const dongs = new Map();
  for (const [admCode, category, longitude, latitude, road] of points) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) fail('좌표가 숫자가 아닌 점포가 있습니다.');
    if (!dongs.has(admCode)) dongs.set(admCode, new Map());
    const cells = dongs.get(admCode);
    const [x, y] = cellOf(longitude, latitude); const key = `${x}:${y}`;
    if (!cells.has(key)) cells.set(key, { x, y, total: 0, roads: new Map(), categories: new Map() });
    const cell = cells.get(key);
    cell.total += 1;
    cell.categories.set(category, (cell.categories.get(category) || 0) + 1);
    const label = roadLabel(road);
    if (label) cell.roads.set(label, (cell.roads.get(label) || 0) + 1);
  }
  const result = new Map();
  for (const [admCode, cells] of dongs) {
    const list = [...cells.values()];
    const minX = Math.min(...list.map(cell => cell.x)); const minY = Math.min(...list.map(cell => cell.y));
    const width = Math.max(...list.map(cell => cell.x)) - minX + 1; const height = Math.max(...list.map(cell => cell.y)) - minY + 1;
    list.sort((a, b) => a.y - b.y || a.x - b.x);
    const counts = new Map();
    list.forEach((cell, position) => {
      for (const [category, count] of cell.categories) {
        if (!counts.has(category)) counts.set(category, []);
        counts.get(category).push([position, count]);
      }
    });
    result.set(admCode, { origin: [minX, minY], size: [width, height],
      // 가장 흔한 도로명. 수가 같으면 가나다순 앞의 이름으로 정해 결과가 흔들리지 않게 한다.
      cells: list.map(cell => [cell.x - minX, cell.y - minY, cell.total, [...cell.roads].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))[0]?.[0] || '']),
      counts: Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))) });
  }
  return result;
}

/** 격자 파일이 색인과 맞는지 확인한다. 소분류별 합은 색인의 그 동 점포 수와, 칸 합계는 그 동의 원천 행수와 같아야 한다. */
export function validateGrid(input, index) {
  if (!object(input) || input.schemaVersion !== 1) fail('지원하는 격자 자료 형식은 schemaVersion 1입니다.');
  if (input.kind !== index.kind || input.asOf !== index.source.asOf || input.sha256 !== index.source.sha256) fail('격자 자료의 자료 구분·기준일·원본 해시가 색인과 다릅니다.');
  if (input.cellMeters !== CELL_METERS || !object(input.projection) || input.projection.latitudeMeters !== PROJECTION.latitudeMeters || input.projection.longitudeMeters !== PROJECTION.longitudeMeters) fail('격자 자료의 칸 크기나 좌표 근사가 이 앱의 것과 다릅니다.');
  const dong = index.dongs.find(item => item.admCode === input.admCode);
  if (!dong) fail('색인에 없는 행정동의 격자 자료입니다.');
  const pair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isSafeInteger);
  if (!pair(input.origin) || !pair(input.size) || input.size.some(side => side < 1 || side > 5000)) fail('격자 자료의 범위가 올바르지 않습니다.');
  const [width, height] = input.size;
  if (!Array.isArray(input.cells) || input.cells.length < 1 || input.cells.length > width * height) fail('격자 자료에 칸 목록이 필요합니다.');
  const seen = new Set(); let total = 0;
  const cells = input.cells.map(cell => {
    if (!Array.isArray(cell) || cell.length !== 4) fail('격자 칸의 모양이 올바르지 않습니다.');
    const [x, y, count, label] = cell;
    if (![x, y, count].every(Number.isSafeInteger) || x < 0 || y < 0 || x >= width || y >= height || count < 1 || seen.has(`${x}:${y}`)) fail('격자 칸의 위치나 수가 잘못되었거나 겹칩니다.');
    if (typeof label !== 'string' || label.length > 120) fail('격자 칸의 도로명 표시가 올바르지 않습니다.');
    seen.add(`${x}:${y}`); total += count;
    return { x, y, total: count, label };
  });
  if (total !== dong.sourceRowCount) fail('격자 칸의 점포 수 합이 색인의 원천 행수와 다릅니다.');
  if (!object(input.counts)) fail('격자 자료에 소분류별 수가 필요합니다.');
  const positions = new Map(index.categories.map((category, position) => [category.code, position]));
  const perCell = cells.map(() => 0);
  const counts = new Map();
  for (const [code, rows] of Object.entries(input.counts)) {
    if (!positions.has(code) || !Array.isArray(rows)) fail('격자 자료에 색인에 없는 소분류가 있습니다.');
    const used = new Set(); let sum = 0;
    const list = rows.map(row => {
      if (!pair(row) || row[0] < 0 || row[0] >= cells.length || row[1] < 1 || used.has(row[0])) fail('격자 자료의 소분류별 수가 잘못되었거나 겹칩니다.');
      used.add(row[0]); sum += row[1]; perCell[row[0]] += row[1];
      return [row[0], row[1]];
    });
    if (sum !== dong.counts[positions.get(code)]) fail('격자 자료의 소분류별 합이 색인의 점포 수와 다릅니다.');
    counts.set(code, list);
  }
  index.categories.forEach((category, position) => { if (dong.counts[position] > 0 && !counts.has(category.code)) fail('색인에 있는 소분류가 격자 자료에 없습니다. 누락을 0으로 처리하지 않습니다.'); });
  if (perCell.some((sum, position) => sum !== cells[position].total)) fail('칸의 소분류별 수 합이 그 칸의 전체 점포 수와 다릅니다.');
  return { admCode: input.admCode, asOf: input.asOf, cellMeters: CELL_METERS, origin: [...input.origin], size: [width, height], cells, counts };
}

/**
 * 그림과 표가 쓸 모양으로 바꾼다. 동이 넓어 한 변이 maxSide칸을 넘으면 이웃한 칸을 묶어 큰 칸으로 본다.
 * 묶은 칸의 도로명은 그 안에서 점포가 가장 많은 작은 칸의 것이다. 수는 더하기만 하며 새 값을 만들지 않는다.
 */
export function gridView(grid, categoryCode, { maxSide = 36 } = {}) {
  const factor = Math.max(1, Math.ceil(Math.max(...grid.size) / maxSide));
  const merged = new Map();
  const at = (cell, position) => {
    const x = Math.floor(cell.x / factor); const y = Math.floor(cell.y / factor); const key = `${x}:${y}`;
    if (!merged.has(key)) merged.set(key, { x, y, total: 0, count: 0, label: '', strongest: 0 });
    const entry = merged.get(key); entry.total += cell.total;
    if (cell.total > entry.strongest) { entry.strongest = cell.total; entry.label = cell.label; }
    return entry;
  };
  const entries = grid.cells.map((cell, position) => at(cell, position));
  for (const [position, count] of grid.counts.get(categoryCode) || []) entries[position].count += count;
  const cells = [...merged.values()].map(({ strongest, ...cell }) => cell).sort((a, b) => b.count - a.count || b.total - a.total || a.y - b.y || a.x - b.x);
  const withStores = cells.filter(cell => cell.count > 0);
  const max = withStores.length ? withStores[0].count : 0;
  return {
    factor, cellMeters: grid.cellMeters * factor, width: Math.ceil(grid.size[0] / factor), height: Math.ceil(grid.size[1] / factor),
    cells, total: withStores.reduce((sum, cell) => sum + cell.count, 0), occupied: withStores.length,
    top: max ? { count: max, cells: withStores.filter(cell => cell.count === max).map(cell => ({ x: cell.x, y: cell.y, label: cell.label })) } : null,
    bins: BINS.map((bin, position) => withStores.filter(cell => binOf(cell.count) === position).length),
  };
}

const SECTORS = [['남서쪽', '남쪽', '남동쪽'], ['서쪽', '가운데', '동쪽'], ['북서쪽', '북쪽', '북동쪽']];
/** 그림을 가로세로 셋으로 나눴을 때 그 칸이 놓인 곳. 같은 도로명의 칸이 여럿일 때 어느 칸인지 가리는 데 쓴다. 점포가 있는 범위 안에서의 위치이며 행정동 안의 방위가 아니다. */
export function sectorOf(view, cell) {
  const third = (value, side) => Math.min(2, Math.floor((value + 0.5) / side * 3));
  return SECTORS[third(cell.y, view.height)][third(cell.x, view.width)];
}

/** 축척 막대에 쓸 길이. 그림 너비의 3분의 1을 넘지 않는 가장 큰 깔끔한 값. */
export function scaleBar(view) {
  const limit = view.width * view.cellMeters / 3;
  const nice = [100, 200, 500, 1000, 2000, 5000, 10000].filter(meters => meters <= limit && meters % view.cellMeters === 0);
  const meters = nice.length ? nice[nice.length - 1] : view.cellMeters;
  return { meters, cells: meters / view.cellMeters };
}
