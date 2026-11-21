import { createHash } from 'node:crypto';

const REQUIRED_HEADERS = ['상가업소번호', '상권업종대분류코드', '상권업종대분류명', '행정동코드', '행정동명', '시도코드', '시도명', '경도', '위도'];
const SMALL_HEADERS = ['상권업종소분류코드', '상권업종소분류명'];
const DISTRICT_HEADERS = ['시군구코드', '시군구명'];
const STORE_HEADERS = ['상호명', '도로명주소'];
const POINT_HEADERS = ['도로명'];
const MARKET_IDS = ['market-a', 'market-b', 'market-c'];
const INDUSTRY_IDS = ['food', 'retail'];
const COMPLETE_SCOPE = '대구광역시 지역배포 CSV 전체';
const LIMITATIONS = [
  '행정동코드별 집계이며 실제 상권 경계·폴리곤·반경 분석이 아닙니다.',
  '분석 지역과 업종 묶음은 개발 제안이며 사용자 확정 전입니다.',
  '원천의 진위·최신성·누락 없는 전체 수집은 자동 검증하지 않았습니다.',
  '점포 수는 소비수요·경쟁 강도·성공확률이나 추천 품질 검증 결과가 아닙니다.',
];

export class CSVParseError extends Error {
  constructor(message, line) { super(`CSV ${line}행: ${message}`); this.name = 'CSVParseError'; this.line = line; }
}

/** Strict quoted-field CSV parser. A trailing newline is allowed; blank records remain visible. */
export function parseCSV(input) {
  if (typeof input !== 'string') throw new TypeError('CSV 입력은 텍스트여야 합니다.');
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records = []; const recordLines = [];
  let record = []; let field = ''; let state = 'start'; let line = 1; let recordLine = 1; let started = false;
  function finishField() { record.push(field); field = ''; state = 'start'; }
  function finishRecord() { finishField(); records.push(record); recordLines.push(recordLine); record = []; started = false; }
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\0') throw new CSVParseError('NUL 문자는 허용하지 않습니다.', line);
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else state = 'closed';
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') { field += '\r\n'; i += 1; }
        else field += char;
        line += 1;
      } else field += char;
      continue;
    }
    if (char === ',') { finishField(); started = true; continue; }
    if (char === '\r' || char === '\n') {
      finishRecord();
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      line += 1; recordLine = line; continue;
    }
    if (state === 'closed') throw new CSVParseError('닫는 따옴표 뒤에는 쉼표 또는 줄바꿈만 올 수 있습니다.', line);
    if (char === '"') {
      if (state !== 'start') throw new CSVParseError('따옴표는 필드 시작에서만 사용할 수 있습니다.', line);
      state = 'quoted'; started = true;
    } else { field += char; state = 'unquoted'; started = true; }
  }
  if (state === 'quoted') throw new CSVParseError('따옴표 필드가 닫히지 않았습니다.', line);
  if (started || field || record.length) finishRecord();
  if (!records.length) throw new CSVParseError('헤더와 원천 행이 필요합니다.', 1);
  return { headers: records[0], rows: records.slice(1), recordLines: recordLines.slice(1) };
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function todaySeoul() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 2000; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function classificationName(value) { return nonempty(value) && !/^(미분류|분류없음|알수없음|unknown|n\/a|null|undefined|-+)$/i.test(value.trim()); }
function hasSmallFilter(config) { return Array.isArray(config?.industries) && config.industries.some(industry => object(industry) && Object.hasOwn(industry, 'smallCodes')); }
function validUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
function validateConfiguration(config, metadata, today, addError) {
  if (!isDate(today)) addError('TODAY_INVALID', 0, '검사 기준일 형식이 올바르지 않습니다.');
  if (!object(config)) { addError('CONFIG_INVALID', 0, '분석 설정 JSON 객체가 필요합니다.'); return; }
  if (!(nonempty(config.version) || Number.isSafeInteger(config.version) && config.version > 0)) addError('CONFIG_VERSION', 0, '분석 설정 버전이 필요합니다.');
  if (config.status !== 'development-proposal') addError('CONFIG_STATUS', 0, '분석 설정 상태는 development-proposal이어야 합니다.');
  if (!Array.isArray(config.markets) || config.markets.length !== 3) addError('MARKETS_INVALID', 0, '고유한 3개 후보 분석지역이 필요합니다.');
  else {
    const ids = new Set(); const codes = new Set();
    for (const market of config.markets) {
      if (!object(market) || !MARKET_IDS.includes(market.id) || ids.has(market.id) || !nonempty(market.name)
        || !nonempty(market.sourceAdmName) || typeof market.admCode !== 'string'
        || !/^27\d{6}$/.test(market.admCode) || codes.has(market.admCode)) addError('MARKET_INVALID', 0, '후보 ID·이름·대구 행정동 8자리 코드·원문 행정동명(sourceAdmName)이 고유하게 설정되어야 합니다.');
      if (object(market)) { ids.add(market.id); codes.add(market.admCode); }
    }
  }
  if (!Array.isArray(config.industries) || config.industries.length !== 2) addError('INDUSTRIES_INVALID', 0, '비교할 2개 업종 설정이 필요합니다.');
  else {
    const ids = new Set(); const codes = new Set(); const smallCodes = new Set(); const smallNames = new Set();
    const smallFiltered = hasSmallFilter(config);
    if (smallFiltered && !config.industries.every(industry => object(industry) && Object.hasOwn(industry, 'smallCodes'))) addError('SMALL_FILTER_MIXED', 0, '비교 업종 모두에 소분류 필터를 지정하거나 모두 생략해야 합니다.');
    for (const industry of config.industries) {
      if (!object(industry) || !INDUSTRY_IDS.includes(industry.id) || ids.has(industry.id) || !nonempty(industry.name)
        || !Array.isArray(industry.majorCodes) || industry.majorCodes.length === 0) { addError('INDUSTRY_INVALID', 0, '고유한 업종 ID·이름·대분류 코드 목록이 필요합니다.'); continue; }
      ids.add(industry.id);
      for (const code of industry.majorCodes) {
        if (typeof code !== 'string' || !/^[A-Z][0-9]$/.test(code) || codes.has(code)) addError('INDUSTRY_CODE_INVALID', 0, '업종 대분류 코드는 중복 없이 영문 대문자와 숫자 조합이어야 합니다.');
        if (!object(industry.majorNames) || !nonempty(industry.majorNames[code])) addError('INDUSTRY_SOURCE_NAME', 0, '선택한 각 대분류 코드의 원문명칭(majorNames)이 필요합니다.');
        codes.add(code);
      }
      if (!smallFiltered && Object.hasOwn(industry, 'smallNames')) addError('SMALL_FILTER_MISSING', 0, '소분류 명칭에는 smallCodes 필터가 함께 필요합니다.');
      if (smallFiltered) {
        if (!Array.isArray(industry.smallCodes) || industry.smallCodes.length === 0 || !object(industry.smallNames)) { addError('SMALL_FILTER_INVALID', 0, '비어 있지 않은 smallCodes와 원문명칭 smallNames가 필요합니다.'); continue; }
        if (Object.keys(industry.smallNames).length !== industry.smallCodes.length || Object.keys(industry.smallNames).some(code => !industry.smallCodes.includes(code))) addError('SMALL_CONFIG_NAMES', 0, '소분류 코드 목록과 원문명칭의 키는 정확히 일치해야 합니다.');
        for (const code of industry.smallCodes) {
          if (typeof code !== 'string' || !/^[A-Z][0-9]{5}$/.test(code) || smallCodes.has(code)) addError('SMALL_CODE_INVALID', 0, '소분류 코드는 중복 없는 영문 대문자와 숫자 5자리여야 합니다.');
          if (typeof code !== 'string' || !industry.majorCodes.includes(code.slice(0, 2))) addError('SMALL_PARENT_CONFIG', 0, '소분류 코드의 부모 대분류가 해당 업종의 majorCodes와 일치해야 합니다.');
          const name = industry.smallNames[code];
          if (!classificationName(name)) addError('SMALL_SOURCE_NAME', 0, '선택 소분류 코드마다 유효한 원문명칭이 필요합니다.');
          else if (smallNames.has(name.trim())) addError('SMALL_CONFIG_NAME_DUPLICATE', 0, '서로 다른 소분류 코드에 같은 명칭을 지정할 수 없습니다.');
          else smallNames.add(name.trim());
          smallCodes.add(code);
        }
      }
    }
  }
  if (!object(metadata)) { addError('METADATA_INVALID', 0, '원천 메타데이터 JSON 객체가 필요합니다.'); return; }
  for (const key of ['title', 'provider', 'asOf', 'retrievedAt', 'sourceUrl', 'classificationVersion', 'license']) {
    if (!nonempty(metadata[key])) addError('METADATA_FIELD', 0, `메타데이터의 ${key}가 필요합니다.`);
  }
  if (metadata.completeScope !== COMPLETE_SCOPE) addError('SCOPE_DECLARATION', 0, `completeScope를 '${COMPLETE_SCOPE}'로 명시해야 합니다. 잘라낸 자료는 지원하지 않습니다.`);
  if (!validUrl(metadata.sourceUrl)) addError('SOURCE_URL', 0, '인증정보 없는 http 또는 https 원천 URL이 필요합니다.');
  for (const key of ['asOf', 'retrievedAt']) {
    if (!isDate(metadata[key]) || isDate(today) && metadata[key] > today) addError('METADATA_DATE', 0, `${key}는 미래가 아닌 유효 YYYY-MM-DD 날짜여야 합니다.`);
  }
  if (isDate(metadata.asOf) && isDate(metadata.retrievedAt) && metadata.asOf > metadata.retrievedAt) addError('METADATA_DATE_ORDER', 0, '기준일은 수집일보다 뒤일 수 없습니다.');
}

/**
 * Structural source checks only. Rejected inputs return no dataset, never silently dropped rows.
 * collectDongs: 같은 검사를 통과한 원천의 모든 행정동을 비교 업종별로 세어 dongs로 함께 돌려준다.
 * 소분류 설정이면 행정동마다 관측된 모든 소분류의 점포 수(small)도 함께 센다.
 * collectStores: 두 기준일의 점포를 번호로 맞춰 보기 위해 유효한 행마다 [번호, 행정동, 소분류, 상호명, 도로명주소]를 돌려준다.
 *   소분류 설정에서만 쓴다. 이 목록은 집계 도구 안에서만 쓰고 화면이나 저장소에 싣지 않는다.
 * collectPoints: 격자로 묶기 위해 유효한 행마다 [행정동, 소분류, 경도, 위도, 도로명]을 돌려준다. 역시 집계 도구 안에서만 쓴다.
 * 거부된 입력에서는 dongs도 null이다.
 */
export function ingestStores(input, config, metadata, { today = todaySeoul(), collectDongs = false, collectStores = false, collectPoints = false } = {}) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  if (!(bytes instanceof Uint8Array)) throw new TypeError('CSV는 UTF-8 텍스트 또는 바이트 배열이어야 합니다.');
  const quality = {
    version: 1, status: 'rejected', checksScope: '원천 CSV의 구조·중복·코드·좌표 검사 및 행정동코드 집계',
    sourceSha256: createHash('sha256').update(bytes).digest('hex'), sourceBytes: bytes.byteLength,
    sourceRows: 0, validRows: 0, invalidRows: 0, selectedSourceRows: 0, aggregatedRows: 0, excludedRows: 0,
    errorCounts: {}, errors: [], errorsTruncated: false, coverage: [], observedMajorCategories: [],
    originVerified: false, completeScopeVerified: false,
    warnings: ['completeScope는 제공자의 선언이며 원천 완전성을 독립 검증한 결과가 아닙니다.', ...LIMITATIONS],
  };
  let errorCount = 0;
  const addError = (code, line, message) => {
    errorCount += 1; quality.errorCounts[code] = (quality.errorCounts[code] || 0) + 1;
    if (quality.errors.length < 100) quality.errors.push({ code, line, message }); else quality.errorsTruncated = true;
  };
  const reject = () => ({ dataset: null, quality, ...(collectDongs ? { dongs: null } : {}), ...(collectStores ? { stores: null } : {}), ...(collectPoints ? { points: null } : {}) });
  validateConfiguration(config, metadata, today, addError);
  if (errorCount) return reject();
  const smallFiltered = hasSmallFilter(config);
  if ((collectStores || collectPoints) && !smallFiltered) { addError('STORES_NEED_SMALL', 0, '점포 목록은 소분류 설정에서만 모읍니다.'); return reject(); }
  const limitations = smallFiltered ? [LIMITATIONS[0], '분석 지역은 개발 제안이며 공인 상권 경계가 아닙니다.', LIMITATIONS[2], LIMITATIONS[3],
    '표시 비중은 선택 소분류 점포 수를 비교하는 두 소분류 점포 수의 합으로 나눈 값이며 전체 업종 점유율·밀도가 아닙니다.'] : LIMITATIONS;
  const requiredHeaders = [...REQUIRED_HEADERS, ...(smallFiltered ? SMALL_HEADERS : []), ...(collectDongs ? DISTRICT_HEADERS : []), ...(collectStores ? STORE_HEADERS : []), ...(collectPoints ? POINT_HEADERS : [])];
  const dongs = new Map(); const stores = []; const points = [];
  if (smallFiltered) {
    quality.version = 2;
    quality.checksScope += ' 및 원천 전체 소분류 코드·명칭·부모 관계 검사';
    quality.observedSmallCategories = [];
    quality.warnings = [quality.warnings[0], ...limitations];
    quality.selectedClassification = { level: 'small', industries: config.industries.map(industry => ({
      id: industry.id, name: industry.name.trim(), codes: [...industry.smallCodes],
      names: Object.fromEntries(industry.smallCodes.map(code => [code, industry.smallNames[code].trim()])), parentCodes: [...industry.majorCodes],
    })) };
  }
  let parsed;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\ufffd')) throw new Error('대체문자가 포함되어 UTF-8 원문을 신뢰할 수 없습니다.');
    parsed = parseCSV(text);
  } catch (error) { addError('CSV_PARSE', error.line || 0, error.message); return reject(); }
  quality.sourceRows = parsed.rows.length;
  const headers = parsed.headers.map(value => value.trim());
  if (new Set(headers).size !== headers.length || headers.some(value => !value)) addError('HEADERS_INVALID', 1, '헤더는 중복되거나 비어 있을 수 없습니다.');
  for (const name of requiredHeaders) if (!headers.includes(name)) addError('HEADER_MISSING', 1, `필수 헤더가 없습니다: ${name}`);
  if (!parsed.rows.length) addError('SOURCE_EMPTY', 1, '원천 점포 행이 없습니다.');
  if (errorCount) return reject();
  const indices = Object.fromEntries(requiredHeaders.map(name => [name, headers.indexOf(name)]));
  const storeIds = new Set(); const categoryNames = new Map(); const adminNames = new Map();
  const sourceSmallCategories = new Map(); const sourceSmallNameCodes = new Map();
  const coverage = new Map(config.markets.map(market => [market.admCode, { marketId: market.id, admCode: market.admCode, sourceRowCount: 0 }]));
  const counts = new Map(config.markets.flatMap(market => config.industries.map(industry => [`${market.id}:${industry.id}`, 0])));
  const industryByCode = new Map(config.industries.flatMap(industry => (smallFiltered ? industry.smallCodes : industry.majorCodes).map(code => [code, industry.id])));
  const expectedCategoryNames = new Map(config.industries.flatMap(industry => industry.majorCodes.map(code => [code, industry.majorNames[code].trim()])));
  const expectedSmallNames = new Map(smallFiltered ? config.industries.flatMap(industry => industry.smallCodes.map(code => [code, industry.smallNames[code].trim()])) : []);
  const expectedAdminNames = new Map(config.markets.map(market => [market.admCode, market.sourceAdmName.trim()]));
  for (let i = 0; i < parsed.rows.length; i += 1) {
    const row = parsed.rows[i]; const line = parsed.recordLines[i]; const before = errorCount;
    if (row.length !== headers.length) { addError('ROW_WIDTH', line, `헤더 ${headers.length}개와 필드 ${row.length}개가 일치하지 않습니다.`); quality.invalidRows += 1; continue; }
    const get = name => row[indices[name]].trim();
    const storeId = get('상가업소번호'); const category = get('상권업종대분류코드'); const categoryName = get('상권업종대분류명');
    const admin = get('행정동코드'); const adminName = get('행정동명');
    if (!storeId) addError('STORE_ID_MISSING', line, '상가업소번호가 비었습니다.');
    else if (storeIds.has(storeId)) addError('STORE_ID_DUPLICATE', line, '같은 상가업소번호가 원천에서 중복되었습니다.');
    storeIds.add(storeId);
    if (!/^[A-Z][0-9]$/.test(category) || !categoryName || /^(미분류|분류없음|알수없음|unknown)$/i.test(categoryName)) addError('CATEGORY_INVALID', line, '유효한 대분류 코드와 분류명이 필요합니다.');
    if (categoryNames.has(category) && categoryNames.get(category) !== categoryName) addError('CATEGORY_NAME_MISMATCH', line, '동일한 대분류 코드에 서로 다른 분류명이 있습니다.');
    else categoryNames.set(category, categoryName);
    if (expectedCategoryNames.has(category) && expectedCategoryNames.get(category) !== categoryName) addError('CATEGORY_CONFIG_NAME_MISMATCH', line, '선택 대분류 코드의 원문명칭이 분석 설정(majorNames)과 다릅니다.');
    let smallCategory;
    if (smallFiltered) {
      smallCategory = get('상권업종소분류코드'); const smallName = get('상권업종소분류명');
      if (!/^[A-Z][0-9]{5}$/.test(smallCategory) || !classificationName(smallName)) addError('SMALL_CATEGORY_INVALID', line, '원천 전체 행에 유효한 소분류 코드와 명칭이 필요합니다.');
      if (smallCategory.slice(0, 2) !== category) addError('SMALL_PARENT_MISMATCH', line, '소분류 코드의 부모 대분류가 해당 행의 대분류 코드와 다릅니다.');
      const previous = sourceSmallCategories.get(smallCategory);
      if (previous && previous.name !== smallName) addError('SMALL_NAME_MISMATCH', line, '동일 소분류 코드에 서로 다른 명칭이 있습니다.');
      if (previous && previous.majorCode !== category) addError('SMALL_PARENT_INCONSISTENT', line, '동일 소분류 코드가 서로 다른 부모 대분류에 연결되어 있습니다.');
      if (!previous) sourceSmallCategories.set(smallCategory, { code: smallCategory, name: smallName, majorCode: category });
      if (sourceSmallNameCodes.has(smallName) && sourceSmallNameCodes.get(smallName) !== smallCategory) addError('SMALL_NAME_DUPLICATE', line, '서로 다른 소분류 코드가 같은 명칭을 사용합니다.');
      else sourceSmallNameCodes.set(smallName, smallCategory);
      if (expectedSmallNames.has(smallCategory) && expectedSmallNames.get(smallCategory) !== smallName) addError('SMALL_CONFIG_NAME_MISMATCH', line, '선택 소분류 코드의 원문명칭이 분석 설정(smallNames)과 다릅니다.');
    }
    if (!/^27\d{6}$/.test(admin) || !adminName) addError('ADMIN_INVALID', line, '대구 행정동 8자리 코드와 이름이 필요합니다.');
    if (adminNames.has(admin) && adminNames.get(admin) !== adminName) addError('ADMIN_NAME_MISMATCH', line, '동일한 행정동 코드에 서로 다른 이름이 있습니다.');
    else adminNames.set(admin, adminName);
    if (expectedAdminNames.has(admin) && expectedAdminNames.get(admin) !== adminName) addError('ADMIN_CONFIG_NAME_MISMATCH', line, '선택 행정동 코드의 원문명칭이 분석 설정(sourceAdmName)과 다릅니다.');
    if (get('시도코드') !== '27' || get('시도명') !== '대구광역시') addError('PROVINCE_MISMATCH', line, '대구광역시(27) 이외의 행은 전체 지역배포 파일 선언과 일치하지 않습니다.');
    const longitudeText = get('경도'); const latitudeText = get('위도');
    const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
    const longitude = Number(longitudeText); const latitude = Number(latitudeText);
    if (!numeric.test(longitudeText) || !numeric.test(latitudeText) || !Number.isFinite(longitude) || !Number.isFinite(latitude)) addError('COORDINATE_MISSING', line, '경도·위도는 비어 있지 않은 십진수여야 합니다.');
    else if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) addError('COORDINATE_RANGE', line, '경위도 세계 범위를 벗어났거나 경도와 위도가 뒤바뀌었습니다.');
    // A broad plausibility envelope, deliberately not an administrative boundary check.
    else if (longitude < 126 || longitude > 131 || latitude < 34 || latitude > 38) addError('COORDINATE_IMPLAUSIBLE', line, '대구 원천으로 보기 어려운 좌표입니다. 이 검사는 경계·폴리곤 판정이 아닙니다.');
    let district;
    if (collectDongs) {
      district = { code: get('시군구코드'), name: get('시군구명') };
      if (!/^27\d{3}$/.test(district.code) || !district.name || !admin.startsWith(district.code)) addError('DISTRICT_INVALID', line, '행정동 코드와 맞는 대구 시군구 5자리 코드와 이름이 필요합니다.');
      const known = dongs.get(admin);
      if (known && (known.districtCode !== district.code || known.district !== district.name)) addError('DISTRICT_MISMATCH', line, '동일한 행정동 코드가 서로 다른 시군구에 연결되어 있습니다.');
    }
    if (errorCount > before) { quality.invalidRows += 1; continue; }
    quality.validRows += 1;
    if (collectStores) stores.push([storeId, admin, smallCategory, get('상호명'), get('도로명주소')]);
    if (collectPoints) points.push([admin, smallCategory, longitude, latitude, get('도로명')]);
    if (collectDongs) {
      let dong = dongs.get(admin);
      if (!dong) { dong = { admCode: admin, name: adminName, districtCode: district.code, district: district.name, sourceRowCount: 0, counts: Object.fromEntries(config.industries.map(industry => [industry.id, 0])), ...(smallFiltered ? { small: {} } : {}) }; dongs.set(admin, dong); }
      dong.sourceRowCount += 1;
      const dongIndustry = industryByCode.get(smallFiltered ? smallCategory : category);
      if (dongIndustry) dong.counts[dongIndustry] += 1;
      if (smallFiltered) dong.small[smallCategory] = (dong.small[smallCategory] || 0) + 1;
    }
    if (!coverage.has(admin)) { quality.excludedRows += 1; continue; }
    const entry = coverage.get(admin); entry.sourceRowCount += 1; quality.selectedSourceRows += 1;
    const industryId = industryByCode.get(smallFiltered ? smallCategory : category);
    if (!industryId) { quality.excludedRows += 1; continue; }
    const key = `${entry.marketId}:${industryId}`; counts.set(key, counts.get(key) + 1); quality.aggregatedRows += 1;
  }
  quality.coverage = [...coverage.values()].map(entry => ({ ...entry, sourceAdmName: adminNames.get(entry.admCode) || null }));
  quality.observedMajorCategories = [...categoryNames].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
  if (smallFiltered) quality.observedSmallCategories = [...sourceSmallCategories.values()].sort((a, b) => a.code.localeCompare(b.code));
  if (smallFiltered) {
    // Without a separate classification registry, a never-observed configured code is unverified mapping,
    // not proof that the selected regions contain zero stores in that category.
    for (const code of expectedSmallNames.keys()) {
      if (!sourceSmallCategories.has(code)) addError('SMALL_CONFIG_UNOBSERVED', 0, `선택 소분류 코드 ${code}를 원천 전체에서 확인하지 못했습니다. 매핑 미확인을 점포 0개로 처리하지 않습니다.`);
    }
  }
  for (const entry of quality.coverage) if (entry.sourceRowCount === 0) addError('MARKET_COVERAGE_EMPTY', 0, `${entry.marketId} 행정동의 유효한 원천 행이 없습니다. 미수집을 0개로 바꾸지 않습니다.`);
  if (errorCount) return reject();
  quality.status = 'accepted';
  const analysis = {
    method: 'administrative-dong-code', status: config.status, version: String(config.version),
    markets: config.markets.map(market => ({ id: market.id, name: market.name.trim(), admCode: market.admCode,
      sourceAdmName: adminNames.get(market.admCode), sourceRowCount: coverage.get(market.admCode).sourceRowCount })),
    industries: config.industries.map(industry => ({ id: industry.id, name: industry.name.trim(), majorCodes: [...industry.majorCodes],
      majorNames: Object.fromEntries(industry.majorCodes.map(code => [code, industry.majorNames[code].trim()])),
      ...(smallFiltered ? { smallCodes: [...industry.smallCodes], smallNames: Object.fromEntries(industry.smallCodes.map(code => [code, industry.smallNames[code].trim()])) } : {}) })),
    completeScope: metadata.completeScope, sourceSha256: quality.sourceSha256, sourceRows: quality.sourceRows,
    qualityStatus: 'structural-checks-passed', originVerified: false, completeScopeVerified: false, limitations: [...limitations],
  };
  const dataset = {
    schemaVersion: smallFiltered ? 2 : 1, kind: 'user-supplied',
    source: { title: metadata.title.trim(), url: metadata.sourceUrl.trim(), asOf: metadata.asOf,
      retrievedAt: metadata.retrievedAt, scope: `${metadata.completeScope} 중 ${config.markets.map(market => `${market.name}(${market.admCode})`).join(' / ')} 행정동코드 집계`,
      classificationVersion: metadata.classificationVersion.trim(), provider: metadata.provider.trim(), license: metadata.license.trim(), sha256: quality.sourceSha256 },
    analysis,
    observations: config.markets.flatMap(market => config.industries.map(industry => ({ marketId: market.id, industryId: industry.id, count: counts.get(`${market.id}:${industry.id}`) }))),
  };
  return { dataset, quality, ...(collectDongs ? { dongs: [...dongs.values()].sort((a, b) => a.admCode.localeCompare(b.admCode)) } : {}), ...(collectStores ? { stores } : {}), ...(collectPoints ? { points } : {}) };
}
