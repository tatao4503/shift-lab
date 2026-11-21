import { assessCosts } from './costs.js';

export const MARKETS = Object.freeze([
  Object.freeze({ id: 'market-a', name: '대구 후보 상권 A' }),
  Object.freeze({ id: 'market-b', name: '대구 후보 상권 B' }),
  Object.freeze({ id: 'market-c', name: '대구 후보 상권 C' }),
]);

export const INDUSTRIES = Object.freeze([
  Object.freeze({ id: 'food', name: '외식업' }),
  Object.freeze({ id: 'retail', name: '생활밀착형 소매업' }),
]);

const marketIds = new Set(MARKETS.map(({ id }) => id));
const industryIds = new Set(INDUSTRIES.map(({ id }) => id));
const goals = { stable: '안정 운영', test: '소규모 검증', expand: '단계적 확장' };
const risks = { low: '낮음', medium: '보통', high: '높음' };
const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });

function fail(message) { throw new Error(message); }

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function seoulToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

function textField(object, key) {
  const value = object[key];
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) {
    fail(`출처의 ${key} 항목은 1~1,000자의 텍스트여야 합니다.`);
  }
  return value.trim();
}

function validateIndustries(items, smallRequired) {
  if (!Array.isArray(items) || items.length !== 2) fail('두 업종의 분류 정의가 필요합니다.');
  const usedMajor = new Set();
  const usedSmall = new Set();
  return INDUSTRIES.map(({ id }) => {
    const matches = items.filter(item => item && item.id === id);
    if (matches.length !== 1) fail('업종 정의의 ID가 누락되거나 중복되었습니다.');
    const item = matches[0];
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || !Array.isArray(item.majorCodes) || item.majorCodes.length < 1 || item.majorCodes.length > 10) fail('업종 이름과 대분류 코드가 필요합니다.');
    for (const code of item.majorCodes) {
      // 소분류로 세는 자료는 두 업종이 같은 대분류에 속해도 이중 집계가 없다. 겹침은 소분류 코드에서 막는다.
      if (typeof code !== 'string' || !/^[A-Z]\d$/.test(code) || (!smallRequired && usedMajor.has(code)) || item.majorCodes.indexOf(code) !== item.majorCodes.lastIndexOf(code)) fail('대분류 코드가 잘못되었거나 겹칩니다.');
      if (!item.majorNames || typeof item.majorNames[code] !== 'string' || !item.majorNames[code].trim() || item.majorNames[code].length > 120) fail('원천 대분류 코드의 이름이 필요합니다.');
      usedMajor.add(code);
    }
    const result = { id, name: item.name.trim(), majorCodes: [...item.majorCodes], majorNames: Object.fromEntries(item.majorCodes.map(code => [code, item.majorNames[code].trim()])) };
    if (!smallRequired) {
      if (item.smallCodes !== undefined || item.smallNames !== undefined) fail('소분류 자료는 schemaVersion 2로 제공해 주세요.');
      return result;
    }
    if (!Array.isArray(item.smallCodes) || item.smallCodes.length < 1 || item.smallCodes.length > 20) fail('schemaVersion 2에는 소분류 코드가 필요합니다.');
    for (const code of item.smallCodes) {
      if (typeof code !== 'string' || !/^[A-Z]\d{5}$/.test(code) || usedSmall.has(code)) fail('소분류 코드가 잘못되었거나 겹칩니다.');
      if (!item.majorCodes.includes(code.slice(0, 2))) fail('소분류와 상위 대분류 코드가 일치하지 않습니다.');
      if (!item.smallNames || typeof item.smallNames[code] !== 'string' || !item.smallNames[code].trim() || item.smallNames[code].length > 120) fail('원천 소분류 코드의 이름이 필요합니다.');
      usedSmall.add(code);
    }
    return { ...result, smallCodes: [...item.smallCodes], smallNames: Object.fromEntries(item.smallCodes.map(code => [code, item.smallNames[code].trim()])) };
  });
}

export function getIndustries(dataset) {
  return dataset.analysis?.industries || dataset.industries || INDUSTRIES;
}

/** Import validation checks structure; it does not verify origin or geographic coverage. */
export function validateDataset(input, { today = seoulToday() } = {}) {
  if (!validDate(today)) fail('검사 기준일이 올바르지 않습니다.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('데이터는 JSON 객체여야 합니다.');
  if (![1, 2].includes(input.schemaVersion)) fail('지원하는 데이터 형식은 schemaVersion 1 또는 2입니다.');
  if (!['synthetic', 'user-supplied', 'public-file'].includes(input.kind)) fail('지원하지 않는 데이터 구분입니다.');
  if (!input.source || typeof input.source !== 'object' || Array.isArray(input.source)) fail('출처 정보가 필요합니다.');
  const source = {};
  for (const key of ['title', 'asOf', 'retrievedAt', 'scope', 'classificationVersion']) {
    source[key] = textField(input.source, key);
  }
  if (typeof input.source.url !== 'string') fail('출처 URL은 텍스트여야 합니다.');
  source.url = input.source.url.trim();
  if (source.url || input.kind !== 'synthetic') {
    let url;
    try { url = new URL(source.url); } catch { fail('출처 URL에 올바른 http 또는 https 주소가 필요합니다.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      fail('출처 URL에는 인증정보 없는 http 또는 https 주소만 사용할 수 있습니다.');
    }
    if (source.url.length > 2000) fail('출처 URL이 너무 깁니다.');
  }
  for (const key of ['asOf', 'retrievedAt']) {
    if (!validDate(source[key])) fail(`${key}는 실제 존재하는 YYYY-MM-DD 날짜여야 합니다.`);
    if (source[key] > today) fail(`${key}는 검사 기준일보다 미래일 수 없습니다.`);
  }
  if (source.asOf > source.retrievedAt) fail('데이터 기준일은 수집일보다 뒤일 수 없습니다.');
  for (const key of ['provider', 'license', 'sha256']) {
    if (input.source[key] !== undefined) source[key] = textField(input.source, key);
  }
  if (source.sha256 && !/^[a-f0-9]{64}$/.test(source.sha256)) fail('원본 SHA-256 형식이 올바르지 않습니다.');
  if (input.kind === 'public-file' && (!source.provider || !source.license || !source.sha256)) fail('공개파일에는 제공기관·이용조건·원본 해시가 필요합니다.');
  if (!Array.isArray(input.observations) || input.observations.length !== 6) {
    fail('상권 3개 × 업종 2개의 6행이 모두 필요합니다. 누락을 0으로 처리하지 않습니다.');
  }
  const seen = new Set();
  const observations = input.observations.map(row => {
    if (!row || typeof row !== 'object' || !marketIds.has(row.marketId) || !industryIds.has(row.industryId)) {
      fail('알 수 없는 상권 또는 업종입니다.');
    }
    const key = `${row.marketId}:${row.industryId}`;
    if (seen.has(key)) fail(`상권·업종 행이 중복되었습니다: ${key}`);
    seen.add(key);
    if (!Number.isSafeInteger(row.count) || row.count < 0) fail('점포 수는 0 이상의 안전한 정수여야 합니다.');
    return { marketId: row.marketId, industryId: row.industryId, count: row.count };
  });
  for (const { id } of MARKETS) {
    const total = observations.filter(row => row.marketId === id).reduce((sum, row) => sum + row.count, 0);
    if (!Number.isSafeInteger(total)) fail('상권별 점포 수 합계가 안전한 정수 범위를 넘었습니다.');
  }
  let analysis;
  if (input.analysis !== undefined) {
    const a = input.analysis;
    if (!a || a.method !== 'administrative-dong-code' || a.status !== 'development-proposal') fail('행정동 분석 방식과 개발안 상태가 필요합니다.');
    if (!(typeof a.version === 'string' && a.version.trim() || Number.isSafeInteger(a.version) && a.version > 0) || String(a.version).length > 100) fail('분석 단위 버전이 필요합니다.');
    if (!Array.isArray(a.markets) || a.markets.length !== 3) fail('세 권역의 행정동 정의가 필요합니다.');
    const codes = new Set();
    const markets = MARKETS.map(({ id }) => {
      const matches = a.markets.filter(m => m && m.id === id);
      if (matches.length !== 1) fail('권역 정의의 ID가 누락되거나 중복되었습니다.');
      const m = matches[0];
      if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 120 || typeof m.admCode !== 'string' || !/^27\d{6}$/.test(m.admCode)) fail('원천의 대구 행정동 이름과 8자리 코드를 확인해 주세요.');
      if (typeof m.sourceAdmName !== 'string' || !m.sourceAdmName.trim() || m.sourceAdmName.length > 120) fail('원천 행정동 이름이 필요합니다.');
      if (codes.has(m.admCode)) fail('행정동 코드가 중복되었습니다.');
      codes.add(m.admCode);
      if (!Number.isSafeInteger(m.sourceRowCount) || m.sourceRowCount < 1) fail('각 권역의 원천 수집행이 필요합니다. 누락을 0으로 처리하지 않습니다.');
      const selected = observations.filter(row => row.marketId === id).reduce((sum, row) => sum + row.count, 0);
      if (selected > m.sourceRowCount) fail('집계한 점포 수가 권역의 원천 행수를 넘었습니다.');
      return { id, name: m.name.trim(), admCode: m.admCode, sourceAdmName: m.sourceAdmName.trim(), sourceRowCount: m.sourceRowCount };
    });
    const industries = validateIndustries(a.industries, input.schemaVersion === 2);
    if (!Number.isSafeInteger(a.sourceRows) || a.sourceRows < markets.reduce((sum, m) => sum + m.sourceRowCount, 0)) fail('원천 전체 행수와 권역별 행수가 맞지 않습니다.');
    if (typeof a.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sourceSha256) || (source.sha256 && source.sha256 !== a.sourceSha256)) fail('원본 해시가 누락되었거나 일치하지 않습니다.');
    if (a.qualityStatus !== 'structural-checks-passed' || a.originVerified !== false || a.completeScopeVerified !== false) fail('원천 구조 검사 상태를 확인해 주세요.');
    if (typeof a.completeScope !== 'string' || !a.completeScope.trim() || a.completeScope.length > 1000) fail('수집 범위 선언이 필요합니다.');
    if (!Array.isArray(a.limitations) || a.limitations.length > 20 || a.limitations.some(t => typeof t !== 'string' || t.length > 1000)) fail('분석 한계 항목을 확인해 주세요.');
    analysis = { method: a.method, status: a.status, version: a.version, markets, industries, completeScope: a.completeScope,
      sourceSha256: a.sourceSha256, sourceRows: a.sourceRows, qualityStatus: a.qualityStatus, originVerified: false, completeScopeVerified: false, limitations: [...a.limitations] };
  }
  if ((input.kind === 'public-file' || input.schemaVersion === 2 && input.kind !== 'synthetic') && !analysis) fail('실자료 집계에는 원천 검사와 분석 단위 기록이 필요합니다.');
  let industries;
  if (input.industries !== undefined) {
    if (input.schemaVersion !== 2 || analysis) fail('업종 정의는 한 위치의 schemaVersion 2 자료로 제공해 주세요.');
    industries = validateIndustries(input.industries, true);
  }
  if (input.schemaVersion === 2 && !analysis && !industries) fail('schemaVersion 2에는 소분류 업종 정의가 필요합니다.');
  return { schemaVersion: input.schemaVersion, kind: input.kind, source, observations, ...(analysis ? { analysis } : {}), ...(industries ? { industries } : {}) };
}

/** share is ONLY among the two selected comparison industries. */
export function compareMarkets(dataset, industryId) {
  if (!industryIds.has(industryId)) fail('비교할 업종을 선택해 주세요.');
  const data = validateDataset(dataset);
  return (data.analysis?.markets || MARKETS).map(({ id, name, admCode }) => {
    const rows = data.observations.filter(row => row.marketId === id);
    const count = rows.find(row => row.industryId === industryId).count;
    const otherCount = rows.find(row => row.industryId !== industryId).count;
    const total = count + otherCount;
    return { marketId: id, name, count, otherCount, share: total === 0 ? null : count / total,
      kind: data.kind, asOf: data.source.asOf, industryName: getIndustries(data).find(item => item.id === industryId).name,
      ...(admCode ? { admCode, boundaryMode: 'administrative-dong-code' } : {}) };
  });
}

export function recommend(profile, row, costPlan) {
  if (!profile || !industryIds.has(profile.industryId)) fail('희망 업종을 선택해 주세요.');
  if (!Number.isFinite(profile.budgetManwon) || profile.budgetManwon <= 0 || profile.budgetManwon > Number.MAX_SAFE_INTEGER) {
    fail('창업 가능 자금은 0보다 큰 숫자로 입력해 주세요.');
  }
  if (!Number.isInteger(profile.months) || profile.months < 1 || profile.months > 120) fail('예상 운영기간은 1~120개월로 입력해 주세요.');
  if (!Object.hasOwn(goals, profile.goal) || !Object.hasOwn(risks, profile.risk)) fail('운영목표와 위험 감수 수준을 선택해 주세요.');
  if (!row || !marketIds.has(row.marketId) || !Number.isSafeInteger(row.count) || row.count < 0) fail('비교 상권 정보가 올바르지 않습니다.');
  const industry = row.industryName || INDUSTRIES.find(({ id }) => id === profile.industryId).name;
  const reasons = [
    `${row.name}의 ${industry} ${number.format(row.count)}곳은 ${row.kind === 'synthetic' ? '가상 예시' : row.kind === 'public-file' ? '공개 상가업소 파일' : '사용자가 불러온 자료'}의 집계값입니다. 수요나 수익을 뜻하지 않습니다.`,
    `운영목표는 ‘${goals[profile.goal]}’, 위험 감수 수준은 ‘${risks[profile.risk]}’으로 입력했습니다.`,
  ];
  const ruleIds = ['R_DATA_LIMIT', `R_GOAL_${profile.goal.toUpperCase()}`, `R_RISK_${profile.risk.toUpperCase()}`];
  let title;
  if (profile.goal === 'test') {
    title = '기간을 정한 소규모 실험 검토';
    reasons.push('소규모 검증 목표에 따라 장기 계약에 앞서 실험 기간·중단 조건을 먼저 정하는 검토 규칙을 적용했습니다.');
  } else if (profile.risk === 'low' || profile.goal === 'stable') {
    title = '고정비 확인 후 소규모 수요 검증';
    reasons.push('안정 운영 또는 낮은 위험 감수 입력에 따라 고정비와 철수 비용을 먼저 확인하는 검토 규칙을 적용했습니다.');
  } else if (profile.goal === 'expand') {
    title = '확장 조건을 확인하며 단계적 진입 검토';
    reasons.push('확장 목표에 따라 수요·임대비용·초기 투자 회수 조건을 확인한 뒤 단계적으로 검토하도록 제안합니다.');
  } else {
    title = '추가 자료 확보 후 진입 검토';
  }
  if (profile.months <= 6) {
    ruleIds.push('R_SHORT_DURATION');
    reasons.push('운영기간 6개월 이하는 개발용 검토 규칙상 단기 실험으로 분류했습니다. 업종의 적정 운영기간을 검증한 기준은 아닙니다.');
  } else {
    ruleIds.push('R_LONG_DURATION');
    reasons.push(`입력한 ${profile.months}개월 동안 고정비를 감당할 수 있는지 월별 현금흐름을 확인해야 합니다.`);
  }
  const costs = assessCosts(profile, costPlan);
  if (costs.status === 'opening-shortfall') title = '초기 비용 조정 후 재검토';
  else if (costs.status === 'period-shortfall') title = '목표 기간의 비용 부족분 확인';
  else if (costs.status === 'zero-monthly-cost') title = '월 고정비 입력 범위 재확인';
  else if (costs.status === 'within-entered-plan') title = '입력 비용 범위에서 수요 검증 계속';
  reasons.push(...costs.reasons);
  ruleIds.push(...costs.ruleIds);
  const checks = [
    '입력한 보증금·기타 초기 투입액·월 고정비의 견적 출처와 누락 항목을 확인하세요. 지역 시세를 자동 추정하지 않습니다.',
    row.boundaryMode ? '권역은 행정동 기준의 개발안입니다. 실제 출점 위치에 맞는 공간 범위와 세부 업종을 검토하세요.' : '실제 상권 이름·공간 경계와 두 업종의 세부 분류를 확정하세요.',
    '자료의 기준일·출처·중복 제거·전체 수집 여부를 원본과 대조하세요.',
    '보증금·권리금·설비비·월세·인건비를 구분해 입력 예산과 비교하세요.',
    '현장 조사와 실제 수요 자료를 확보하세요. 점포 수만으로 기회나 위험 수준을 판정하지 않습니다.',
    '제안 규칙은 사용자 검증 전입니다. 계약·투자 결정 전 개별 조건을 확인하세요.',
  ];
  return { title, reasons, checks, ruleIds, costs };
}
