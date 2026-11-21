function fail(message) { throw new Error(message); }

const lookups = new WeakMap();
function lookup(index) {
  if (!lookups.has(index)) {
    lookups.set(index, {
      dongs: new Map(index.dongs.map(dong => [dong.admCode, dong])),
      categories: new Map(index.categories.map((category, position) => [category.code, { ...category, position }])),
    });
  }
  return lookups.get(index);
}

/** 두 색인이 같은 원천의 서로 다른 기준일인지 확인한다. 순서가 뒤집히거나 같은 파일이면 견주지 않는다. */
export function validateIndexPair(current, previous) {
  if (!current || !previous) fail('견줄 두 시점의 색인이 필요합니다.');
  if (current.kind !== previous.kind) fail('두 색인의 자료 구분이 다릅니다. 공개파일 집계와 사용자 제공 자료를 섞어 견주지 않습니다.');
  if (!(previous.source.asOf < current.source.asOf)) fail('이전 시점 색인의 기준일이 지금 색인보다 앞서야 합니다.');
  if (previous.source.sha256 === current.source.sha256) fail('두 색인의 원본이 같습니다. 서로 다른 기준일의 파일이 필요합니다.');
  if (previous.analysis.completeScope !== current.analysis.completeScope) fail('두 색인의 수집 범위 선언이 다릅니다.');
  if (previous.source.url !== current.source.url || previous.source.provider !== current.source.provider) fail('두 색인의 원문 출처나 제공기관이 다릅니다. 같은 원천의 다른 기준일만 견줍니다.');
  return { previousAsOf: previous.source.asOf, currentAsOf: current.source.asOf };
}

/** 견줄 이전 기준일들을 확인하고 가까운 날짜부터 놓는다. 같은 기준일이 둘이면 받지 않는다. */
export function orderHistory(current, previousIndexes) {
  if (!Array.isArray(previousIndexes) || previousIndexes.length > 8) fail('이전 기준일 색인은 8개까지 둘 수 있습니다.');
  const seen = new Set();
  for (const previous of previousIndexes) {
    const { previousAsOf } = validateIndexPair(current, previous);
    if (seen.has(previousAsOf)) fail('같은 기준일의 색인이 둘 있습니다.');
    seen.add(previousAsOf);
  }
  return [...previousIndexes].sort((a, b) => b.source.asOf.localeCompare(a.source.asOf));
}

/**
 * 같은 행정동·같은 소분류의 수록 점포 수를 두 시점에서 견준다.
 * 어느 한쪽에 그 행정동이나 분류가 없거나 이름이 달라졌으면 0으로 치지 않고 비교 불가로 돌려준다.
 * 증감은 원천에 수록된 점포 수의 차이다. 개업·폐업 수가 아니며, 원천의 정비나 재분류가 섞일 수 있다.
 */
export function countChange(current, previous, admCode, categoryCode) {
  const now = lookup(current); const then = lookup(previous);
  const dong = now.dongs.get(admCode); const category = now.categories.get(categoryCode);
  if (!dong || !category) fail('지금 색인에 없는 행정동이나 업종입니다.');
  const count = dong.counts[category.position];
  const unavailable = status => ({ status, previous: null, current: count, delta: null });
  const oldDong = then.dongs.get(admCode);
  if (!oldDong) return unavailable('dong-missing');
  if (oldDong.name !== dong.name) return unavailable('dong-renamed');
  const oldCategory = then.categories.get(categoryCode);
  if (!oldCategory) return unavailable('category-missing');
  if (oldCategory.name !== category.name) return unavailable('category-renamed');
  const before = oldDong.counts[oldCategory.position];
  return { status: 'ok', previous: before, current: count, delta: count - before };
}

/** 두 시점에서 견줄 수 있는 행정동과 소분류가 얼마나 되는지 센다. 화면과 확인 기록에 그대로 적는다. */
export function describeComparability(current, previous) {
  const now = lookup(current); const then = lookup(previous);
  const side = (a, b) => {
    const common = []; const renamed = []; const onlyCurrent = []; const onlyPrevious = [];
    for (const [code, item] of a) {
      const other = b.get(code);
      if (!other) onlyCurrent.push({ code, name: item.name });
      else if (other.name !== item.name) renamed.push({ code, previousName: other.name, name: item.name });
      else common.push(code);
    }
    for (const [code, item] of b) if (!a.has(code)) onlyPrevious.push({ code, name: item.name });
    return { comparable: common.length, renamed, onlyCurrent, onlyPrevious };
  };
  return { ...validateIndexPair(current, previous), dongs: side(now.dongs, then.dongs), categories: side(now.categories, then.categories) };
}

const reasons = {
  'dong-missing': '이전 시점 원천에 이 행정동 코드가 없습니다.',
  'dong-renamed': '이전 시점과 행정동 이름이 달라 같은 범위인지 확인되지 않았습니다.',
  'category-missing': '이전 시점 원천에서 이 소분류가 관측되지 않았습니다.',
  'category-renamed': '이전 시점과 소분류 이름이 달라 같은 분류인지 확인되지 않았습니다.',
};
export function changeReason(status) {
  return reasons[status] || '';
}
