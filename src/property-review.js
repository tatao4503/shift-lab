const number = new Intl.NumberFormat('ko-KR');
const costLabels = {
  depositManwon: '보증금',
  setupManwon: '기타 초기 투입액',
  monthlyRentManwon: '월세',
  monthlyOtherFixedManwon: '기타 월 고정비',
  reserveManwon: '공통 유보금',
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function amount(value) {
  if (value == null) return '미입력';
  return value === 0 ? '0원' : `${number.format(value)}만 원`;
}

function propertyLabel(property, slot) {
  const label = `매물 ${'ABC'[slot]}`;
  return property.name === label ? label : `${label} · ${property.name}`;
}

function balanceState(gap) {
  return gap < 0 ? 'shortfall' : gap > 0 ? 'remaining' : 'even';
}

function definitionList(pairs, className) {
  const list = element('dl', undefined, className);
  for (const [label, value] of pairs) {
    const line = element('div');
    line.append(element('dt', label), element('dd', value));
    list.append(line);
  }
  return list;
}

function nextCheck(property) {
  const { costs, evidence, quoteDate } = property;
  if (costs.status === 'incomplete') {
    const missing = costs.missingFields.map(key => costLabels[key]).join(', ');
    return `${missing}의 금액을 확인하세요.`;
  }
  if (evidence === 'unknown' || evidence === 'assumption' || evidence === 'verbal') {
    return '비용 항목이 적힌 견적을 받아 금액과 포함 범위를 확인하세요.';
  }
  if (!quoteDate) return '받은 견적의 날짜와 유효기간을 확인하세요.';
  if (costs.monthlyFixedManwon === 0) return '월 고정비가 0원입니다. 빠진 월 비용이 있는지 확인하세요.';
  return costs.targetGapManwon < 0
    ? '예산 부족액을 기준으로 다시 견적받을 항목을 골라보세요.'
    : '견적에 포함된 비용과 별도로 낼 비용을 확인하세요.';
}

function costSummary(costs) {
  if (costs.status === 'incomplete') {
    const pending = element('div', undefined, 'property-review-cost');
    pending.append(element('p', '계산 보류', 'property-review-amount'));
    pending.append(element('p', '비어 있는 비용을 입력하면 계산합니다.', 'property-review-meta'));
    return pending;
  }
  const gap = costs.targetGapManwon;
  const summary = definitionList([
    ['목표기간 필요자금', amount(costs.targetRequiredManwon)],
    [gap < 0 ? '예산 부족액' : gap === 0 ? '예산 차이' : '입력 비용 반영 후 잔액', amount(Math.abs(gap))],
  ], 'property-review-cost property-review-cost-values');
  summary.dataset.balance = balanceState(gap);
  return summary;
}

function budgetOverview(properties, budget) {
  const requiredAmounts = properties
    .filter(property => property.costs.status !== 'incomplete')
    .map(property => property.costs.targetRequiredManwon);
  if (!requiredAmounts.length) return null;

  // A little space to the right keeps the budget line visible even when it sets the scale.
  const axisMax = Math.max(budget, ...requiredAmounts) * 1.05;
  const percent = value => `${(value / axisMax) * 100}%`;
  const overview = element('section', undefined, 'property-review-overview');
  overview.setAttribute('aria-label', '매물별 필요자금 비교');
  overview.style.setProperty('--property-budget-line', percent(budget));

  const header = element('div', undefined, 'property-overview-head');
  header.append(element('h4', '매물별 필요자금'), element('p', `공통 예산선 · ${amount(budget)}`, 'property-overview-key'));
  const list = element('ul', undefined, 'property-overview-list');
  // Keep list semantics available to VoiceOver when CSS hides the bullets.
  list.setAttribute('role', 'list');
  properties.forEach((property, slot) => {
    const { costs } = property;
    const row = element('li', undefined, 'property-overview-row');
    const track = element('span', undefined, 'property-overview-track');
    track.setAttribute('aria-hidden', 'true');
    const values = element('div', undefined, 'property-overview-values');
    if (costs.status === 'incomplete') {
      row.dataset.balance = 'pending';
      values.append(element('span', '비용 입력 대기', 'property-overview-balance'));
    } else {
      const gap = costs.targetGapManwon;
      row.dataset.balance = balanceState(gap);
      const bar = element('span', undefined, 'property-overview-bar');
      bar.style.width = percent(costs.targetRequiredManwon);
      track.append(bar);
      const gapText = gap === 0 ? '예산과 같음' : `${amount(Math.abs(gap))} ${gap < 0 ? '부족' : '남음'}`;
      values.append(element('strong', amount(costs.targetRequiredManwon)), element('span', gapText, 'property-overview-balance'));
    }
    row.append(element('strong', propertyLabel(property, slot), 'property-overview-label'), track, values);
    list.append(row);
  });
  overview.append(header, list);
  return overview;
}

function propertyCard(property, industryName, slot) {
  const { area, costs, evidenceLabel, followUp, inputs, quoteDate } = property;
  const card = element('article', undefined, 'property-review-card');
  const evidence = `비용 입력 근거: ${evidenceLabel}${quoteDate ? ` · ${quoteDate}` : ' · 날짜 미입력'}`;
  const detailsId = `property-review-details-${'abc'[slot]}`;
  const toggle = element('button', '비용 내역·확인 사항', 'property-review-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', `매물 ${'ABC'[slot]} 비용 내역·확인 사항`);
  toggle.setAttribute('aria-controls', detailsId);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', String(toggle.getAttribute('aria-expanded') === 'false'));
  });

  const details = element('div', undefined, 'property-review-details');
  details.id = detailsId;
  details.append(
    element('p', evidence, 'property-review-meta property-review-evidence-mobile'),
    definitionList(Object.entries(costLabels).slice(0, 4).map(([key, label]) => [label, amount(inputs[key])]), 'property-review-inputs'),
  );
  const checks = element('div', undefined, 'property-review-next');
  checks.append(element('h5', '계약 전 확인'), element('p', nextCheck(property)));
  if (followUp) checks.append(element('p', `내 메모: ${followUp}`, 'property-review-memo'));
  details.append(checks);

  // Keep evidence before totals in print and within the keyboard disclosure on phones.
  card.append(
    element('h4', propertyLabel(property, slot)),
    element('p', `${area.district} ${area.name} · 행정동 ${industryName} ${number.format(area.count)}곳`, 'property-review-area'),
    element('p', evidence, 'property-review-meta property-review-evidence-wide'),
    costSummary(costs),
    toggle,
    details,
  );
  return card;
}

export function renderPropertyReview(container, report) {
  const { industry, source, budgetManwon, months, reserveManwon, properties } = report;
  const terms = definitionList([
    ['검토 업종', `${industry.name} (${industry.code})`],
    ['공통 예산', amount(budgetManwon)],
    ['목표기간', `${number.format(months)}개월`],
    ['공통 유보금', amount(reserveManwon)],
  ], 'property-review-terms');
  const cards = element('div', undefined, 'property-review-grid');
  cards.dataset.columns = String(properties.length);
  cards.append(...properties.map((property, slot) => propertyCard(property, industry.name, slot)));
  const overview = budgetOverview(properties, budgetManwon);

  const scope = element('div', undefined, 'property-review-scope');
  scope.append(
    element('h4', '자료 출처와 계산 범위'),
    element('p', `${source.title} · 자료 기준일 ${source.asOf}. 점포 수는 행정동 단위로 집계하며 같은 동의 매물에는 같은 수가 표시됩니다.`),
    element('p', '매물 비용·입력 근거·날짜는 사용자가 기입한 내용입니다. 매출 유입은 0원으로 두고 입력한 비용을 계산합니다. 변동비와 보증금 반환 시점은 계산에 포함되지 않습니다.'),
  );
  if (typeof source.url === 'string' && /^https?:\/\//.test(source.url)) {
    const link = element('a', source.url, 'property-review-source-link');
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    scope.children[1].append(element('br'), link);
  }
  container.replaceChildren(terms, ...(overview ? [overview] : []), cards, scope);
}
