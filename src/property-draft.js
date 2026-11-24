import { findDong } from './dongs.js';
import { PROPERTY_EVIDENCE } from './properties.js';

export const MAX_PROPERTY_DRAFT_BYTES = 32_768;
const format = 'shift-lab/property-draft';
const version = 1;
const draftSlots = ['a', 'b', 'c'];
const commonKeys = ['industryCode', 'budgetManwon', 'months', 'reserveManwon'];
const amountFields = [
  ['depositManwon', '보증금'],
  ['setupManwon', '기타 초기 투입액'],
  ['monthlyRentManwon', '월세'],
  ['monthlyOtherFixedManwon', '기타 월 고정비'],
];
const propertyKeys = ['name', 'admCode', ...amountFields.map(([key]) => key), 'evidence', 'quoteDate', 'followUp'];

function hasFields(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function requireAmount(value, label, min = 0, max = 10_000_000) {
  if (value === '') return;
  if (!/^\d{1,20}$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${label} 항목의 숫자 범위를 확인해 주세요.`);
  }
}

function requireLine(value, max, label) {
  if (value.length > max || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)) {
    throw new Error(`${label} 항목은 한 줄에 ${max}자까지 입력해 주세요.`);
  }
}

function requireValidDate(value) {
  if (value === '') return;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01') {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value) return;
  }
  throw new Error('조건 확인일은 달력에 있는 날짜로 입력해 주세요.');
}

function validateDraft(draft, index) {
  if (!hasFields(draft, ['includeThird', 'common', 'properties'])
    || typeof draft.includeThird !== 'boolean' || !hasFields(draft.common, commonKeys)
    || !hasFields(draft.properties, draftSlots)) {
    throw new Error('매물 검토 입력 파일에 필요한 항목이 없습니다.');
  }
  const { common, properties } = draft;
  if (commonKeys.some(key => typeof common[key] !== 'string')) {
    throw new Error('공통 검토 조건을 읽을 수 없습니다.');
  }
  if (common.industryCode && (!/^[A-Z]\d{5}$/.test(common.industryCode)
    || (index && !index.categories.some(item => item.code === common.industryCode)))) {
    throw new Error('이 버전에서 사용할 수 없는 업종입니다.');
  }
  requireAmount(common.budgetManwon, '검토 예산', 1);
  requireAmount(common.months, '목표 운영기간', 1, 120);
  requireAmount(common.reserveManwon, '공통 유보금');
  for (const slot of draftSlots) {
    const entry = properties[slot];
    try {
      if (!hasFields(entry, propertyKeys) || propertyKeys.some(key => typeof entry[key] !== 'string')) {
        throw new Error('매물 입력 항목을 읽을 수 없습니다.');
      }
      if (entry.admCode && (!/^27\d{6}$/.test(entry.admCode) || (index && !findDong(index, entry.admCode)))) {
        throw new Error('이 버전에서 사용할 수 없는 행정동입니다.');
      }
      for (const [key, label] of amountFields) requireAmount(entry[key], label);
      if (!Object.hasOwn(PROPERTY_EVIDENCE, entry.evidence)) throw new Error('입력 근거를 확인해 주세요.');
      requireValidDate(entry.quoteDate);
      requireLine(entry.name, 24, '매물 별칭');
      requireLine(entry.followUp, 60, '다시 확인할 항목');
    } catch (error) {
      throw new Error(`매물 ${slot.toUpperCase()} · ${error.message}`);
    }
  }
  return draft;
}

export function serializePropertyDraft(draft) {
  return JSON.stringify({ format, version, draft: validateDraft(draft) }, null, 2);
}

export function parsePropertyDraft(text, index) {
  if (typeof text !== 'string' || text.length > MAX_PROPERTY_DRAFT_BYTES
    || new TextEncoder().encode(text).length > MAX_PROPERTY_DRAFT_BYTES) {
    throw new Error('매물 검토 입력 파일은 32KB 이하여야 합니다.');
  }
  let file;
  try {
    file = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('매물 검토 입력 파일을 읽을 수 없습니다.');
  }
  if (!hasFields(file, ['format', 'version', 'draft']) || file.format !== format || file.version !== version) {
    throw new Error('이 버전에서 읽을 수 있는 매물 검토 입력 JSON을 선택해 주세요.');
  }
  if (index?.kind !== 'public-file') throw new Error('공개 행정동 자료를 읽은 뒤 매물 검토 입력을 불러와 주세요.');
  return validateDraft(file.draft, index);
}

export function downloadPropertyDraft(draft) {
  const blob = new Blob([serializePropertyDraft(draft)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'SHIFT-매물-검토-입력.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
