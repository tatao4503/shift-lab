import { MARKETS, INDUSTRIES, validateDataset } from './domain.js';

function fail(message) { throw new Error(message); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function text(value, max = 120) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }

export function defaultIndustryCodes(index) {
  return index.defaults.industries.map(item => item.code);
}

function compose(index, dongs, industryCodes) {
  const positions = industryCodes.map(code => index.categories.findIndex(category => category.code === code));
  const markets = MARKETS.map(({ id }, slot) => {
    const dong = dongs[slot];
    return { id, name: dong.name, admCode: dong.admCode, sourceAdmName: dong.name, sourceRowCount: dong.sourceRowCount };
  });
  const industries = INDUSTRIES.map(({ id }, slot) => {
    const category = index.categories[positions[slot]];
    const preset = index.defaults.industries.find(item => item.code === category.code);
    return { id, name: preset ? preset.name : category.name, majorCodes: [category.majorCode], majorNames: { [category.majorCode]: index.majors[category.majorCode] },
      smallCodes: [category.code], smallNames: { [category.code]: category.name } };
  });
  const isDefault = defaultIndustryCodes(index).every((code, slot) => code === industryCodes[slot]);
  const described = industries.map(industry => `${industry.smallCodes[0]}=${industry.smallNames[industry.smallCodes[0]]}(부모 ${industry.majorCodes[0]}=${industry.majorNames[industry.majorCodes[0]]})`);
  return {
    schemaVersion: 2, kind: index.kind,
    source: { ...index.source,
      scope: `${index.analysis.completeScope} 중 ${markets.map(market => `${market.name}(${market.admCode})`).join(' / ')} 행정동코드 집계`,
      classificationVersion: `${index.classification.label}: ${described.join(', ')} / ${index.classification.note}` },
    analysis: { ...index.analysis, version: isDefault ? index.analysis.version : `${index.indexVersion}:${industryCodes.join(':')}`, markets, industries },
    observations: markets.flatMap((market, slot) => INDUSTRIES.map(({ id }, industrySlot) => ({ marketId: market.id, industryId: id, count: dongs[slot].counts[positions[industrySlot]] }))),
  };
}

/**
 * 행정동 색인은 원천 CSV 전체를 같은 구조 검사로 통과시킨 뒤 행정동코드와 소분류별로 센 집계다.
 * 점포 수만 담는다. 면적·밀도·수요·순위는 담지 않으며 여기서 만들지도 않는다.
 */
export function validateDongIndex(input, options) {
  if (!object(input)) fail('행정동 색인은 JSON 객체여야 합니다.');
  if (input.schemaVersion !== 2) fail('지원하는 행정동 색인 형식은 schemaVersion 2입니다.');
  if (!['public-file', 'user-supplied'].includes(input.kind)) fail('행정동 색인의 자료 구분이 올바르지 않습니다.');
  if (!object(input.source) || !object(input.analysis)) fail('행정동 색인에 출처와 분석 기록이 필요합니다.');
  if (input.analysis.markets !== undefined || input.analysis.industries !== undefined || input.source.scope !== undefined || input.source.classificationVersion !== undefined) {
    fail('행정동 색인에는 선택 권역·업종이나 집계 범위 문장을 담지 않습니다.');
  }
  if (!object(input.classification) || !text(input.classification.label, 200) || !text(input.classification.note, 200)) fail('행정동 색인에 분류판 표기가 필요합니다.');
  if (!text(input.indexVersion, 60) || !/^[A-Za-z0-9._-]+$/.test(input.indexVersion)) fail('행정동 색인 버전이 필요합니다.');
  if (!object(input.majors)) fail('행정동 색인에 대분류 이름이 필요합니다.');
  if (!Array.isArray(input.categories) || input.categories.length < 2 || input.categories.length > 2000) fail('행정동 색인에는 2개 이상의 소분류가 필요합니다.');
  const codes = new Set(); const names = new Set(); const majors = {};
  const categories = input.categories.map(item => {
    if (!object(item) || typeof item.code !== 'string' || !/^[A-Z]\d{5}$/.test(item.code) || codes.has(item.code)) fail('소분류 코드가 잘못되었거나 겹칩니다.');
    if (!text(item.name) || names.has(item.name.trim())) fail('소분류 이름이 없거나 겹칩니다.');
    if (item.majorCode !== item.code.slice(0, 2) || !text(input.majors[item.majorCode])) fail('소분류의 상위 대분류 코드와 이름을 확인해 주세요.');
    codes.add(item.code); names.add(item.name.trim()); majors[item.majorCode] = input.majors[item.majorCode].trim();
    return { code: item.code, name: item.name.trim(), majorCode: item.majorCode };
  });
  if (Object.keys(input.majors).length !== Object.keys(majors).length) fail('쓰이지 않는 대분류 이름이 있습니다.');
  if (!object(input.defaults) || !Array.isArray(input.defaults.industries) || input.defaults.industries.length !== INDUSTRIES.length) fail('행정동 색인에 기본 두 업종이 필요합니다.');
  const defaults = { industries: INDUSTRIES.map(({ id }, slot) => {
    const item = input.defaults.industries[slot];
    if (!object(item) || item.id !== id || !codes.has(item.code) || !text(item.name)) fail('기본 업종은 색인에 있는 소분류여야 합니다.');
    return { id, code: item.code, name: item.name.trim() };
  }) };
  if (defaults.industries[0].code === defaults.industries[1].code) fail('기본 두 업종은 서로 달라야 합니다.');
  if (!Array.isArray(input.dongs) || input.dongs.length < 3 || input.dongs.length > 1000) fail('행정동 색인에는 3곳 이상의 행정동이 필요합니다.');
  const admCodes = new Set(); let rows = 0;
  const dongs = input.dongs.map(item => {
    if (!object(item) || typeof item.admCode !== 'string' || !/^27\d{6}$/.test(item.admCode) || admCodes.has(item.admCode)) fail('행정동 코드가 잘못되었거나 겹칩니다.');
    admCodes.add(item.admCode);
    if (!text(item.name) || !text(item.district) || typeof item.districtCode !== 'string' || !/^27\d{3}$/.test(item.districtCode) || !item.admCode.startsWith(item.districtCode)) fail('행정동 이름과 시군구 이름·코드를 확인해 주세요.');
    if (!Number.isSafeInteger(item.sourceRowCount) || item.sourceRowCount < 1) fail('행정동마다 원천 행수가 필요합니다. 원천에 없는 행정동을 0곳으로 넣지 않습니다.');
    if (!Array.isArray(item.counts) || item.counts.length !== categories.length) fail('행정동마다 모든 소분류의 점포 수가 필요합니다. 누락을 0으로 처리하지 않습니다.');
    let total = 0;
    for (const count of item.counts) {
      if (!Number.isSafeInteger(count) || count < 0) fail('점포 수는 0 이상의 정수여야 합니다.');
      total += count;
    }
    if (total !== item.sourceRowCount) fail('행정동의 소분류별 점포 수 합이 원천 행수와 다릅니다.');
    rows += item.sourceRowCount;
    return { admCode: item.admCode, name: item.name.trim(), districtCode: item.districtCode, district: item.district.trim(), sourceRowCount: item.sourceRowCount, counts: [...item.counts] };
  });
  if (!Number.isSafeInteger(input.analysis.sourceRows) || rows > input.analysis.sourceRows) fail('행정동별 행수의 합이 원천 전체 행수를 넘었습니다.');
  const index = { schemaVersion: 2, kind: input.kind, source: { ...input.source },
    classification: { label: input.classification.label.trim(), note: input.classification.note.trim() },
    analysis: { ...input.analysis }, indexVersion: input.indexVersion, defaults, majors, categories, dongs };
  // 출처·분류·검사 상태는 비교 자료와 같은 규칙으로 확인한다.
  const checked = validateDataset(compose(index, dongs.slice(0, 3), defaultIndustryCodes(index)), options);
  const { markets, industries, ...analysis } = checked.analysis;
  const { scope, classificationVersion, ...source } = checked.source;
  return { ...index, source, analysis };
}

/** 고른 세 행정동과 두 업종으로 화면이 쓰는 비교 자료를 만든다. 색인에 있는 값만 옮기며 새 수치를 만들지 않는다. */
export function datasetFromIndex(index, admCodes, industryCodes = defaultIndustryCodes(index), options) {
  if (!Array.isArray(admCodes) || admCodes.length !== MARKETS.length) fail('비교할 행정동 세 곳을 골라 주세요.');
  if (new Set(admCodes).size !== admCodes.length) fail('같은 행정동을 두 번 고를 수 없습니다. 서로 다른 세 곳을 골라 주세요.');
  if (!Array.isArray(industryCodes) || industryCodes.length !== INDUSTRIES.length) fail('비교할 업종 두 개를 골라 주세요.');
  if (industryCodes[0] === industryCodes[1]) fail('같은 업종을 두 번 고를 수 없습니다. 서로 다른 두 업종을 골라 주세요.');
  if (industryCodes.some(code => !index.categories.some(category => category.code === code))) fail('색인에 없는 업종입니다. 원천에서 관측된 소분류만 고를 수 있습니다.');
  const dongs = admCodes.map(code => index.dongs.find(dong => dong.admCode === code) || fail('색인에 없는 행정동입니다. 원천에 행이 있는 행정동만 고를 수 있습니다.'));
  return validateDataset(compose(index, dongs, industryCodes), options);
}

/** 고르기 목록용: 시군구 코드 순, 그 안에서는 이름 가나다순. 점포 수로 줄 세우지 않는다. */
export function groupDongs(index) {
  const groups = new Map();
  for (const dong of index.dongs) {
    if (!groups.has(dong.districtCode)) groups.set(dong.districtCode, { districtCode: dong.districtCode, district: dong.district, dongs: [] });
    groups.get(dong.districtCode).dongs.push({ admCode: dong.admCode, name: dong.name });
  }
  return [...groups.values()].sort((a, b) => a.districtCode.localeCompare(b.districtCode))
    .map(group => ({ ...group, dongs: group.dongs.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true })) }));
}

/** 고르기 목록용: 대분류 코드 순, 그 안에서는 소분류 코드 순(원천 분류표의 순서). 점포 수로 줄 세우지 않는다. */
export function groupCategories(index) {
  const groups = new Map();
  for (const category of [...index.categories].sort((a, b) => a.code.localeCompare(b.code))) {
    if (!groups.has(category.majorCode)) groups.set(category.majorCode, { majorCode: category.majorCode, major: index.majors[category.majorCode], categories: [] });
    groups.get(category.majorCode).categories.push({ code: category.code, name: category.name });
  }
  return [...groups.values()].sort((a, b) => a.majorCode.localeCompare(b.majorCode));
}

export function findDong(index, admCode) {
  return index.dongs.find(dong => dong.admCode === admCode) || null;
}
