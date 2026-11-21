const number = new Intl.NumberFormat('ko-KR');
const dateTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short',
});

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function definitionList(pairs, className) {
  const list = element('dl', undefined, className);
  for (const [label, value, itemClass] of pairs) {
    const item = element('div', undefined, itemClass);
    const description = element('dd');
    if (typeof value === 'string') description.textContent = value;
    else description.append(value);
    item.append(element('dt', label), description);
    list.append(item);
  }
  return list;
}

function amount(value) {
  return value == null ? '미입력' : value === 0 ? '0원' : `${number.format(value)}만 원`;
}

function changeText(change, flow) {
  if (change.status !== 'ok') return '비교 불가';
  // 드나듦이 있으면 그때의 수 대신 빠짐·새로를 적는다. 그때의 수는 지금 수와 차이로 알 수 있다.
  if (flow) return `${change.delta === 0 ? '같음' : `${number.format(Math.abs(change.delta))}곳 ${change.delta > 0 ? '많음' : '적음'}`} · 빠짐 ${number.format(flow.out)} · 새로 ${number.format(flow.in)}`;
  if (change.delta === 0) return `같음 (${number.format(change.previous)}곳)`;
  return `${number.format(Math.abs(change.delta))}곳 ${change.delta > 0 ? '많음' : '적음'} (${number.format(change.previous)}곳)`;
}

function industryLabel(industry) {
  const codes = (industry.smallCodes || industry.majorCodes)?.join(', ');
  return codes ? `${industry.name} (${codes})` : industry.name;
}

function hashCode(hash) {
  const code = element('code', undefined, 'review-source-hash');
  code.append(element('span', hash.slice(0, 32)), element('wbr'), element('span', hash.slice(32)));
  return code;
}

function comparisonCard(row, industry, other, report, costFields) {
  const card = element('article', undefined, 'review-card');
  card.dataset.marketId = row.marketId;

  const heading = element('div', undefined, 'review-card-heading');
  heading.append(element('h4', row.name));
  if (row.admCode) heading.append(element('p', `행정동 코드 ${row.admCode}`, 'review-metadata'));
  card.append(heading);

  const { costs, title } = row.strategy;
  if (report.datasetKind !== 'synthetic') {
    const cost = element('div', undefined, 'review-cost');
    if (costs.status === 'incomplete') {
      cost.append(element('p', '비용 미입력 · 필요액과 예산 차이 계산 보류', 'review-cost-pending'));
    } else {
      const gap = costs.targetGapManwon;
      const result = definitionList([
        ['목표기간 필요액', amount(costs.targetRequiredManwon)],
        [gap < 0 ? '추가 필요액' : '입력 비용 제외 잔액', amount(Math.abs(gap))],
      ], 'review-cost-result');
      result.dataset.balance = gap < 0 ? 'shortfall' : gap > 0 ? 'surplus' : 'even';
      cost.append(result);
      if (costs.monthlyFixedManwon === 0) {
        cost.append(element('p', '월 고정비 0원 입력 · 충당개월 산출 보류', 'review-metadata'));
      }
    }
    card.append(cost);
  }

  card.append(definitionList([
    [industry.name, `${number.format(row.count)}곳`],
    [other.name, `${number.format(row.otherCount)}곳`],
    // 이름이 긴 업종에서도 한 줄에 들어가도록 줄 이름에 업종 이름을 되풀이하지 않는다. 두 줄 모두 맨 위의 검토 업종 기준이다.
    ['두 업종 중 검토 업종 비중', row.share === null ? '산출 불가' : `${(row.share * 100).toFixed(1)}%`],
    ...(report.changeBasis && row.changes ? row.changes.map(entry => [entry.asOf, changeText(entry[report.profile.industryId], entry.flows ? entry.flows[report.profile.industryId] : null), 'review-change']) : []),
  ], 'review-pairs review-store-counts'));
  const inputs = report.datasetKind === 'synthetic' ? null : report.costScenario.input?.markets[row.marketId];
  if (inputs) card.append(definitionList(
    costFields.map(([key, label]) => [label, amount(inputs[key])]), 'review-pairs review-inputs',
  ));
  card.append(element('p', title, 'review-next'));
  return card;
}

export function renderReview(container, report, labels, costFields) {
  const { profile, source, analysis } = report;
  const industry = report.industries.find(item => item.id === profile.industryId);
  const other = report.industries.find(item => item.id !== profile.industryId);
  const synthetic = report.datasetKind === 'synthetic';
  const scope = element('div', undefined, 'review-scope');
  const scopeMeta = element('div', undefined, 'review-scope-meta');
  scopeMeta.append(
    element('strong', report.status, 'review-scope-kind'),
    element('p', `검토안 생성 ${dateTime.format(new Date(report.generatedAt))} (한국시간)`, 'review-metadata'),
  );
  scope.append(
    scopeMeta,
    definitionList([
      ['검토 업종', industryLabel(industry)],
      ['검토 예산', amount(profile.budgetManwon)],
      ['목표기간', `${profile.months}개월`],
      ['자료 기준일', source.asOf],
    ], 'review-profile'),
    element('p', `운영목표 ${labels.goal} · 위험 감수 ${labels.risk}`, 'review-metadata'),
  );
  if (synthetic) {
    scope.append(element('p', '가상 점포 수는 화면 확인용입니다. 이 자료에는 비용 검토를 제공하지 않습니다.', 'review-assumptions'));
  } else {
    scope.append(element('p', `사용자 입력 비용 가정 · 공통 유보금 ${amount(report.costScenario.input?.reserveManwon)}. 실제 점포 견적은 별도로 확인하세요.`, 'review-assumptions'));
  }

  const cards = element('div', undefined, 'review-grid');
  cards.append(...report.comparisons.map(row => comparisonCard(row, industry, other, report, costFields)));
  const comparisonNote = element('p', `비중 = 검토 업종 ÷ 두 업종 점포 수 합계.${report.changeBasis ? (report.changeBasis.flowMatching ? ' 날짜 줄 = 그 기준일보다 많고 적음, 빠짐·새로 = 번호로 맞춘 드나듦(폐업·개업 수 아님).' : ' 날짜 줄 = 그 기준일보다 많고 적음(개업·폐업 수 아님).') : ''} ${analysis ? '행정동 기준 개발용 비교이며 상권 경계·면적·수요는 별도로 확인하세요.' : '실제 비교 공간 범위와 수요는 별도로 확인하세요.'}`, 'review-metadata');
  const checks = element('div', undefined, 'review-checks');
  checks.append(element('h3', '계약 전에 확인할 사항'));
  const checkList = element('ul');
  checkList.append(...report.comparisons[0].strategy.checks.map(item => element('li', item)));
  checks.append(checkList);

  const citations = element('div', undefined, 'review-sources');
  citations.append(element('h3', '자료 출처와 계산 범위'), definitionList([
    ['자료명', source.title],
    ['수집·생성일', source.retrievedAt],
    ['집계 범위', source.scope],
    ['비교 업종', `${industryLabel(industry)} · ${industryLabel(other)}`],
    ['분류판', source.classificationVersion],
    ['원문 출처', source.url || '가상 예시용으로 직접 생성'],
    ...(source.provider ? [['제공기관', source.provider]] : []),
    ...((source.sha256 || analysis?.sourceSha256) ? [['원본 SHA-256', hashCode(source.sha256 || analysis.sourceSha256)]] : []),
  ], 'review-source-pairs'));
  if (!synthetic) {
    citations.append(element('p', '필요액 = 보증금 + 기타 초기 투입액 + 공통 유보금 + 목표개월 × (월세 + 기타 월 고정비). 매출 유입은 0으로 두며 변동비, 미입력 비용, 보증금 반환 시점은 반영하지 않습니다. 잔액과 부족액은 입력 비용 범위의 계산입니다.' + (report.changeBasis ? ` 대비 자료: 같은 원천의 ${report.changeBasis.previousSources.map(previous => previous.asOf).join(', ')} 기준 파일.` : ''), 'review-metadata'));
  }
  container.replaceChildren(scope, element('h3', '후보별 비교'), cards, comparisonNote, checks, citations);
}
