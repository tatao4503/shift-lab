// 먼저 가게를 닫아 본 사람들의 경험 기록.
// 사람과 가게가 드러나는 내용(이름·상호·주소·행정동·금액)은 담지 않는다. 화면에는 '몇 명이 말했다'는 수만 낸다.
// 이 기록으로 폐업의 원인이나 확률을 말하지 않는다. 계약 전에 무엇을 확인할지 떠올리게 하는 데만 쓴다.

export const MAX_EXPERIENCE_BYTES = 262_144;
export const MAX_EXPERIENCE_RECORDS = 300;
const format = 'shift-lab/experiences';
const version = 1;

/** 계약 전에 놓치기 쉬운 비용·조건. 실제 기록이 쌓이기 전의 초안이며, 목록에 없는 것은 '기타'와 메모로 적는다. */
export const EXPERIENCE_ITEMS = Object.freeze({
  restoration: '원상복구·철거비',
  premium: '권리금',
  maintenance: '관리비·공과금',
  vat: '부가세 포함 여부',
  interior: '인테리어 추가 공사',
  equipment: '설비·집기',
  utility: '전기 증설·소방·인허가',
  brokerage: '중개수수료',
  'rent-rise': '임대료 인상 조건',
  'deposit-return': '보증금 반환 시점',
  franchise: '가맹비·위약금',
  loan: '대출 이자',
  other: '기타',
});

/** 처음 예상한 초기비와 실제로 든 돈의 차이. 금액은 받지 않고 방향만 적는다. */
export const EXPERIENCE_SETUP = Object.freeze({
  more: '예상보다 더 들었다',
  similar: '예상과 비슷했다',
  less: '예상보다 덜 들었다',
  unknown: '말하지 않음',
});

const recordKeys = ['id', 'industryCode', 'districtCode', 'recordedMonth', 'missed', 'missedNote', 'setup', 'wouldCheck', 'wouldCheckNote', 'consent', 'compensated'];
const inputKeys = recordKeys.filter(key => key !== 'id');

function fail(message) { throw new Error(message); }
function hasFields(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function requireItems(value, label) {
  if (!Array.isArray(value) || value.some(key => typeof key !== 'string' || !Object.hasOwn(EXPERIENCE_ITEMS, key)) || new Set(value).size !== value.length) {
    fail(`${label} 항목을 읽을 수 없습니다.`);
  }
  // 고른 순서가 달라도 같은 기록이 되도록 목록의 순서로 맞춘다.
  return Object.keys(EXPERIENCE_ITEMS).filter(key => value.includes(key));
}

function requireNote(value, label) {
  if (typeof value !== 'string' || value.length > 120 || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)) fail(`${label}는 한 줄에 120자까지 적어 주세요.`);
  const note = value.trim();
  // 연락처나 번호가 메모에 섞여 들어가지 않게 막는다. 이름과 상호는 기계로 가릴 수 없어 기록하는 사람이 지킨다.
  if (/@/.test(note) || /\d[\d\s.-]{5,}\d/.test(note)) fail(`${label}에 연락처나 번호를 적지 마세요.`);
  return note;
}

function validateRecord(record, index) {
  if (!hasFields(record, recordKeys)) fail('경험 기록에 필요한 항목이 없거나 모르는 항목이 있습니다.');
  if (typeof record.id !== 'string' || !/^E\d{3}$/.test(record.id)) fail('경험 기록의 번호를 읽을 수 없습니다.');
  if (typeof record.industryCode !== 'string' || !index.categories.some(item => item.code === record.industryCode)) fail('이 버전에서 사용할 수 없는 업종입니다.');
  if (record.districtCode !== '' && !index.dongs.some(dong => dong.districtCode === record.districtCode)) fail('이 버전에서 사용할 수 없는 구·군입니다.');
  if (typeof record.recordedMonth !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(record.recordedMonth)) fail('기록한 달을 읽을 수 없습니다.');
  if (!Object.hasOwn(EXPERIENCE_SETUP, record.setup)) fail('초기비 차이 항목을 읽을 수 없습니다.');
  // 동의 없이 받은 말은 파일에 담지 않는다.
  if (record.consent !== true) fail('기록에 동의한 분의 말만 담을 수 있습니다.');
  if (typeof record.compensated !== 'boolean') fail('사례비 항목을 읽을 수 없습니다.');
  const missed = requireItems(record.missed, '놓친 비용');
  const wouldCheck = requireItems(record.wouldCheck, '다시 확인할 것');
  const missedNote = requireNote(record.missedNote, '놓친 비용 메모');
  const wouldCheckNote = requireNote(record.wouldCheckNote, '다시 확인할 것 메모');
  if (missed.includes('other') && !missedNote) fail('놓친 비용에서 ‘기타’를 골랐으면 메모에 무엇인지 적어 주세요.');
  if (wouldCheck.includes('other') && !wouldCheckNote) fail('다시 확인할 것에서 ‘기타’를 골랐으면 메모에 무엇인지 적어 주세요.');
  if (!missed.length && !wouldCheck.length && record.setup === 'unknown') fail('놓친 비용, 초기비 차이, 다시 확인할 것 가운데 하나는 적어 주세요.');
  return { id: record.id, industryCode: record.industryCode, districtCode: record.districtCode, recordedMonth: record.recordedMonth,
    missed, missedNote, setup: record.setup, wouldCheck, wouldCheckNote, consent: true, compensated: record.compensated };
}

export function emptyExperienceFile() { return { format, version, kind: 'collected', records: [] }; }

/** 파일 전체를 검사하고 새 객체로 돌려준다. kind는 'collected'(실제로 모은 기록)이거나 'demo'(화면 확인용 가상)다. */
export function validateExperienceFile(file, index) {
  if (!hasFields(file, ['format', 'version', 'kind', 'records']) || file.format !== format || file.version !== version) fail('이 버전에서 읽을 수 있는 경험 기록 파일이 아닙니다.');
  if (file.kind !== 'collected' && file.kind !== 'demo') fail('경험 기록의 종류를 읽을 수 없습니다.');
  if (!Array.isArray(file.records) || file.records.length > MAX_EXPERIENCE_RECORDS) fail(`경험 기록은 ${MAX_EXPERIENCE_RECORDS}건까지 담을 수 있습니다.`);
  const seen = new Set();
  const records = file.records.map(record => {
    const valid = validateRecord(record, index);
    if (seen.has(valid.id)) fail('번호가 같은 경험 기록이 있습니다.');
    seen.add(valid.id);
    return valid;
  });
  return { format, version, kind: file.kind, records };
}

export function serializeExperienceFile(file, index) { return JSON.stringify(validateExperienceFile(file, index), null, 2); }

export function parseExperienceFile(text, index) {
  if (typeof text !== 'string' || text.length > MAX_EXPERIENCE_BYTES || new TextEncoder().encode(text).length > MAX_EXPERIENCE_BYTES) fail('경험 기록 파일은 256KB 이하여야 합니다.');
  let file;
  try { file = JSON.parse(text.replace(/^﻿/, '')); } catch { fail('경험 기록 파일을 읽을 수 없습니다.'); }
  return validateExperienceFile(file, index);
}

/** 기록 하나를 더한 새 파일을 돌려준다. 번호는 지금 있는 가장 큰 번호의 다음이다. 가상 예시에는 실제 기록을 섞지 않는다. */
export function appendExperience(file, input, index) {
  if (file.kind !== 'collected') fail('가상 예시에는 실제 기록을 더할 수 없습니다. 가상 예시를 닫고 기록하세요.');
  if (!hasFields(input, inputKeys)) fail('경험 기록에 필요한 항목이 없습니다.');
  if (file.records.length >= MAX_EXPERIENCE_RECORDS) fail(`경험 기록은 ${MAX_EXPERIENCE_RECORDS}건까지 담을 수 있습니다.`);
  const next = file.records.reduce((max, record) => Math.max(max, Number(record.id.slice(1))), 0) + 1;
  if (next > 999) fail('기록 번호를 더 매길 수 없습니다.');
  const record = { id: `E${String(next).padStart(3, '0')}`, ...input };
  return validateExperienceFile({ ...file, records: [...file.records, record] }, index);
}

/**
 * 한 업종의 기록을 센다. 내는 것은 사람 수뿐이다. 비율·순위·점수로 바꾸지 않고, 기록이 없는 항목은 목록에 넣지 않는다.
 * 다른 업종의 기록을 끌어다 채우지 않는다. 몇 건이 더 있는지만 알린다.
 */
export function summarizeExperiences(file, industryCode) {
  const matched = file.records.filter(record => record.industryCode === industryCode);
  const order = Object.keys(EXPERIENCE_ITEMS);
  const items = order.map(key => ({ key, label: EXPERIENCE_ITEMS[key],
    missed: matched.filter(record => record.missed.includes(key)).length,
    wouldCheck: matched.filter(record => record.wouldCheck.includes(key)).length }))
    .filter(item => item.missed || item.wouldCheck)
    .sort((a, b) => b.missed - a.missed || b.wouldCheck - a.wouldCheck || order.indexOf(a.key) - order.indexOf(b.key));
  return {
    kind: file.kind, total: file.records.length, matched: matched.length, others: file.records.length - matched.length,
    compensated: matched.filter(record => record.compensated).length,
    items,
    setup: Object.fromEntries(Object.keys(EXPERIENCE_SETUP).map(key => [key, matched.filter(record => record.setup === key).length])),
    notes: matched.flatMap(record => [record.missedNote, record.wouldCheckNote].filter(Boolean).map(text => ({ id: record.id, text }))),
  };
}

/**
 * 화면이 어떻게 보이는지 확인하는 가상 기록. 실제로 누가 한 말이 아니다.
 * kind가 'demo'라 화면에 가상이라고 표시되고, 실제 기록과 섞이지 않으며, 파일로 저장되지 않는다.
 */
export function demoExperienceFile(index, industryCode) {
  const record = (id, missed, setup, wouldCheck, missedNote = '', wouldCheckNote = '', compensated = true) => ({
    id, industryCode, districtCode: '', recordedMonth: '2026-11', missed, missedNote, setup, wouldCheck, wouldCheckNote, consent: true, compensated });
  return validateExperienceFile({ format, version, kind: 'demo', records: [
    record('E001', ['restoration', 'vat'], 'more', ['restoration'], '(가상) 나갈 때 철거비를 따로 내야 하는 줄 몰랐다'),
    record('E002', ['interior', 'utility'], 'more', ['utility', 'restoration'], '', '(가상) 전기 용량부터 물어보겠다'),
    record('E003', ['restoration', 'maintenance'], 'similar', ['maintenance', 'vat']),
    record('E004', ['vat', 'equipment'], 'more', ['vat']),
    record('E005', ['premium'], 'unknown', ['deposit-return', 'restoration'], '', '', false),
  ] }, index);
}
