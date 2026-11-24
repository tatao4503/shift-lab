import { assessCosts } from './costs.js';
import { findDong } from './dongs.js';

export const PROPERTY_EVIDENCE = Object.freeze({
  unknown: '출처 미확인',
  verbal: '구두로 제시받음',
  written: '문서로 받아봄',
  assumption: '내 가정',
});

const costKeys = ['depositManwon', 'setupManwon', 'monthlyRentManwon', 'monthlyOtherFixedManwon'];
const slots = ['매물 A', '매물 B', '매물 C'];

// Convert form input to the shared calculator's numeric contract without turning a blank into zero.
function numeric(value) {
  if (value == null || value === '') return null;
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

function optionalLine(value, limit, label) {
  if (value == null) return '';
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value) || value.trim().length > limit) {
    throw new Error(`${label} 항목은 한 줄에 ${limit}자까지 입력해 주세요.`);
  }
  return value.trim();
}

function quoteDate(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value) return value;
  }
  throw new Error('조건을 받은 날짜는 달력에 있는 날짜로 입력해 주세요.');
}

/** Compare user-entered property conditions. The validated public index supplies area context only. */
export function assessProperties(index, request) {
  if (index?.kind !== 'public-file') throw new Error('공개 행정동 자료를 읽은 뒤 매물을 비교해 주세요.');
  if (!Array.isArray(request?.properties) || ![2, 3].includes(request.properties.length)) {
    throw new Error('비교할 매물을 두 곳 또는 세 곳 입력해 주세요.');
  }
  const categoryIndex = index.categories.findIndex(item => item.code === request.industryCode);
  if (categoryIndex === -1) throw new Error('공개 자료에 있는 업종을 골라 주세요.');
  const { code, name } = index.categories[categoryIndex];
  const { title, provider, asOf, url } = index.source;
  const budgetManwon = numeric(request.budgetManwon);
  const months = numeric(request.months);
  const reserveManwon = numeric(request.reserveManwon);
  const profile = { budgetManwon, months };
  assessCosts(profile, { reserveManwon });

  const properties = Array.from(request.properties, (property, position) => {
    const slot = slots[position];
    try {
      if (!property || typeof property !== 'object' || Array.isArray(property)) throw new Error('매물 조건을 입력해 주세요.');
      const dong = findDong(index, property.admCode);
      if (!dong) throw new Error('공개 자료에 있는 행정동을 골라 주세요.');
      const evidence = property.evidence ?? 'unknown';
      if (typeof evidence !== 'string' || !Object.hasOwn(PROPERTY_EVIDENCE, evidence)) throw new Error('비용 입력의 출처를 선택해 주세요.');
      const inputs = Object.fromEntries(costKeys.map(key => [key, numeric(property[key])]));
      return {
        name: optionalLine(property.name, 24, '매물 별칭') || slot,
        area: { admCode: dong.admCode, name: dong.name, district: dong.district, count: dong.counts[categoryIndex] },
        evidence, evidenceLabel: PROPERTY_EVIDENCE[evidence], quoteDate: quoteDate(property.quoteDate),
        followUp: optionalLine(property.followUp, 60, '다시 확인할 항목'),
        costs: assessCosts(profile, { ...inputs, reserveManwon }),
        inputs,
      };
    } catch (error) {
      throw new Error(`${slot} · ${error.message}`);
    }
  });

  return { industry: { code, name }, source: { title, provider, asOf, url }, budgetManwon, months, reserveManwon, properties };
}
