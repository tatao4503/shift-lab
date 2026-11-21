const MAX_AMOUNT = 10_000_000;
const fields = [
  ['depositManwon', '보증금'],
  ['setupManwon', '기타 초기 투입액'],
  ['monthlyRentManwon', '월세'],
  ['monthlyOtherFixedManwon', '기타 월 고정비'],
  ['reserveManwon', '공통 유보금'],
];
const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const amount = value => value === 0 ? '0원' : `${number.format(value)}만 원`;
// 받침 유무에 따라 '은/는'을 고른다. 항목 이름이 바뀌어도 조사가 어긋나지 않게 한다.
const topic = label => `${label}${(label.charCodeAt(label.length - 1) - 0xAC00) % 28 === 0 ? '는' : '은'}`;
const limitations = [
  '비용은 사용자가 입력한 미검증 가정입니다. 실제 지역·점포의 비용 견적이나 검증 결과가 아닙니다.',
  '매출 유입을 0으로 둔 단순 계산으로 입력한 월 고정비만 차감합니다. 매출·손익·재료비·카드수수료·세금 등 변동비는 반영하지 않습니다.',
  '보증금은 초기 투입으로 묶이는 자금으로 처리하며 반환 시기·반환 가능성은 반영하지 않습니다.',
  '공통 유보금은 운영비로 쓰지 않고 따로 남겨 두는 금액으로 한 번만 차감합니다.',
  '계산한 개월 수는 입력 고정비의 충당 가능 기간이며 실제 사업 존속기간이 아닙니다.',
  '목표기간의 입력 비용을 충당하더라도 수익성·진입 타당성·창업 성공을 뜻하지 않습니다.',
];

function missing(value) { return value === null || value === undefined || value === ''; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function requireInteger(value, min, max, label, unit) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${topic(label)} ${number.format(min)}~${number.format(max)}${unit} 범위의 정수 숫자로 입력해 주세요.`);
  }
  return value === 0 ? 0 : value;
}

/** A calculation against entered assumptions, never a quote, cash-flow forecast or entry approval. */
export function assessCosts(profile, plan) {
  if (!object(profile)) throw new Error('예산과 목표 운영기간을 입력해 주세요.');
  const budget = requireInteger(profile.budgetManwon, 1, MAX_AMOUNT, '검토 예산', '만 원');
  const months = requireInteger(profile.months, 1, 120, '목표 운영기간', '개월');
  if (plan === undefined || plan === null) plan = {};
  if (!object(plan)) throw new Error('비용 계획은 각 비용 항목을 가진 객체로 입력해 주세요.');
  const values = {};
  const missingFields = [];
  // Inspect every known input before returning incomplete so bad input cannot be hidden by a missing field.
  for (const [key, label] of fields) {
    if (missing(plan[key])) missingFields.push(key);
    else values[key] = requireInteger(plan[key], 0, MAX_AMOUNT, label, '만 원');
  }
  const base = {
    missingFields,
    initialOutlayManwon: null, monthlyFixedManwon: null, availableAfterOpeningManwon: null,
    targetRequiredManwon: null, targetGapManwon: null, additionalNeededManwon: null, monthsCovered: null,
    ruleIds: ['COST_USER_ASSUMPTIONS', 'COST_ZERO_REVENUE_FIXED_ONLY'],
    reasons: [
      `입력 예산 ${amount(budget)}과 목표 운영기간 ${number.format(months)}개월을 사용합니다. 비용 입력은 사용자가 정한 미검증 가정입니다.`,
      '매출·손익·변동비를 반영하지 않아 실제 적자나 사업 존속기간을 계산한 값이 아닙니다.',
    ],
    limitations: [...limitations],
  };
  if (missingFields.length) {
    const labels = fields.filter(([key]) => missingFields.includes(key)).map(([, label]) => label);
    return {
      status: 'incomplete', ...base, ruleIds: [...base.ruleIds, 'COST_MISSING_INPUTS'],
      reasons: [...base.reasons, `추가 입력이 필요한 항목: ${labels.join(', ')}. 빈 항목을 0원으로 바꾸지 않았으며 비용 계산을 보류합니다.`],
    };
  }
  const initialOutlayManwon = values.depositManwon + values.setupManwon;
  const monthlyFixedManwon = values.monthlyRentManwon + values.monthlyOtherFixedManwon;
  const availableAfterOpeningManwon = budget - initialOutlayManwon - values.reserveManwon;
  const targetRequiredManwon = initialOutlayManwon + values.reserveManwon + monthlyFixedManwon * months;
  const targetGapManwon = budget - targetRequiredManwon;
  const additionalNeededManwon = Math.max(0, -targetGapManwon);
  const monthsCovered = monthlyFixedManwon === 0 ? null : Math.floor(Math.max(0, availableAfterOpeningManwon) / monthlyFixedManwon);
  const reasons = [
    ...base.reasons,
    `초기 투입액 ${amount(initialOutlayManwon)}은 보증금 ${amount(values.depositManwon)}과 기타 초기 투입액 ${amount(values.setupManwon)}의 합계입니다. 보증금을 운영비로 다시 사용하지 않았습니다.`,
    `공통 유보금 ${amount(values.reserveManwon)}을 한 번만 차감한 초기 투입 후 가용액은 ${amount(availableAfterOpeningManwon)}입니다.`,
    `월 고정비 ${amount(monthlyFixedManwon)}은 월세 ${amount(values.monthlyRentManwon)}과 기타 월 고정비 ${amount(values.monthlyOtherFixedManwon)}의 합계입니다.`,
    `목표 ${number.format(months)}개월의 필요액은 초기 투입액 + 공통 유보금 + 월 고정비 × 목표기간 = ${amount(targetRequiredManwon)}입니다.`,
  ];
  const ruleIds = [...base.ruleIds, 'COST_DEPOSIT_LOCKED', 'COST_RESERVE_HELD_ONCE'];
  let status;
  if (availableAfterOpeningManwon < 0) {
    status = 'opening-shortfall'; ruleIds.push('COST_OPENING_SHORTFALL');
    reasons.push(`초기 투입액과 공통 유보금만으로도 예산을 ${amount(-availableAfterOpeningManwon)} 초과합니다. 목표기간의 입력 고정비까지 포함하면 추가 필요액은 ${amount(additionalNeededManwon)}입니다.`);
  } else if (monthlyFixedManwon === 0) {
    status = 'zero-monthly-cost'; ruleIds.push('COST_ZERO_MONTHLY');
    reasons.push(`월 고정비가 0원으로 입력되어 충당 가능 개월 수를 산출하지 않았습니다. 초기 투입액과 공통 유보금을 제외한 잔액은 ${amount(targetGapManwon)}이며, 무기한 운영 가능을 뜻하지 않습니다.`);
  } else if (targetGapManwon < 0) {
    status = 'period-shortfall'; ruleIds.push('COST_PERIOD_SHORTFALL');
    reasons.push(`초기 투입 후 가용액은 입력 월 고정비 ${number.format(monthsCovered)}개월분입니다. 목표 ${number.format(months)}개월의 필요액이 예산을 ${amount(additionalNeededManwon)} 초과합니다.`);
  } else {
    status = 'within-entered-plan'; ruleIds.push('COST_WITHIN_ENTERED_PLAN');
    reasons.push(`목표 ${number.format(months)}개월의 입력 필요액을 제외한 잔액은 ${amount(targetGapManwon)}입니다. 입력 비용 범위 안의 계산이며 수익성이나 진입 타당성 판단이 아닙니다.`);
  }
  return {
    status, ...base, initialOutlayManwon, monthlyFixedManwon, availableAfterOpeningManwon,
    targetRequiredManwon, targetGapManwon, additionalNeededManwon, monthsCovered, ruleIds, reasons,
  };
}
