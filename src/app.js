import { MARKETS, getIndustries, validateDataset, compareMarkets, recommend } from './domain.js';
import { assessCosts } from './costs.js';
import { renderReview } from './review.js';
import { splitReasons } from './reasons.js';
import { validateDongIndex, datasetFromIndex, groupDongs, groupCategories, findDong } from './dongs.js';
import { orderHistory, countChange, changeReason } from './changes.js';
import { validateFlows, cellFlow } from './flows.js';
import { validateGrid, gridView, scaleBar, sectorOf, binOf, BINS } from './grid.js';
import { mountPropertyWorkbench } from './property-workbench.js';
import { mountMobileNav } from './mobile-nav.js';
import { mountExperiencePanel } from './experience-panel.js';

const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat('ko-KR');
const manwon = value => value === 0 ? '0원' : `${number.format(value)}만 원`;
const state = { dataset: null, demo: null, publicDataset: null, defaultPublicDataset: null, dongIndex: null, previousIndexes: [], flows: new Map(), gridsEnabled: false, grids: new Map(), selected: MARKETS[0].id, profileDirty: false, costScopes: new Map(), profile: { industryId: 'food', budgetManwon: 5000, months: 12, goal: 'stable', risk: 'low' } };
const costFields = [
  ['depositManwon', '보증금'], ['setupManwon', '기타 초기 투입액'],
  ['monthlyRentManwon', '월세'], ['monthlyOtherFixedManwon', '기타 월 고정비'],
];
const costStatuses = {
  incomplete: '비용 입력 대기', 'opening-shortfall': '초기 투입·유보금이 예산 초과',
  'period-shortfall': '목표 기간 비용 부족', 'within-entered-plan': '입력 비용 범위 내 잔액',
  'zero-monthly-cost': '월 고정비 범위 재확인',
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function status(id, message, isError = false) {
  $(id).textContent = message;
  $(id).classList.toggle('error', isError);
}

function kindLabel() { return state.dataset.kind === 'synthetic' ? '가상 예시 · 분석 결과 아님' : state.dataset.kind === 'public-file' ? '공개파일 집계 · 개발용 권역' : '사용자 제공 · 원천 진위 미검증'; }

function currentCostScope() {
  const key = JSON.stringify({ dataset: state.dataset, industryId: state.profile.industryId });
  if (!state.costScopes.has(key)) {
    const empty = () => Object.fromEntries(MARKETS.map(({ id }) => [id, Object.fromEntries(costFields.map(([field]) => [field, '']))]));
    state.costScopes.set(key, { draft: { reserveManwon: '', markets: empty() }, applied: null, dirty: false });
  }
  return state.costScopes.get(key);
}

function appliedCostPlan(marketId) {
  const applied = currentCostScope().applied;
  return applied ? { ...applied.markets[marketId], reserveManwon: applied.reserveManwon } : undefined;
}

/** 권역 고르기는 내장 공개파일 집계를 보고 있을 때만 쓴다. 가상 예시와 가져온 자료에는 섞지 않는다. */
function canPickDongs() {
  return Boolean(state.dongIndex && state.dataset.analysis && state.dataset === state.publicDataset);
}

const dongCodes = dataset => dataset.analysis.markets.map(market => market.admCode);
const industryCodes = dataset => dataset.analysis.industries.map(industry => industry.smallCodes[0]);

/** 이전 시점 색인이 있고 내장 공개파일 집계를 볼 때만 변화를 낸다. */
function canCompareDates() {
  return Boolean(state.previousIndexes.length && canPickDongs());
}

/** 수록 점포 수의 차이를 말로 옮긴다. 많고 적음만 말하며 좋고 나쁨이나 개업·폐업으로 풀지 않는다. */
function changeWords(change) {
  if (change.status !== 'ok') return '비교 불가';
  if (change.delta === 0) return '같음';
  return `${number.format(Math.abs(change.delta))}곳 ${change.delta > 0 ? '많음' : '적음'}`;
}

function marketChanges(row) {
  if (!canCompareDates()) return null;
  const codes = industryCodes(state.dataset);
  // 가까운 기준일부터, 기준일마다 두 업종의 차이를 낸다.
  // 드나듦(남음·빠짐·새로)은 그 기준일의 대조 자료가 있을 때만 붙인다.
  return state.previousIndexes.map(previous => {
    const flows = state.flows.get(previous.source.asOf);
    return { asOf: previous.source.asOf,
      ...Object.fromEntries(['food', 'retail'].map((id, slot) => [id, countChange(state.dongIndex, previous, row.admCode, codes[slot])])),
      flows: flows ? Object.fromEntries(['food', 'retail'].map((id, slot) => [id, cellFlow(flows, previous, row.admCode, codes[slot])])) : null };
  });
}

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attributes = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

/** 고른 행정동의 격자 자료를 필요할 때 한 번씩 읽는다. 색인과 맞지 않으면 그 동의 그림만 내지 않는다. */
async function loadGrid(admCode) {
  if (state.grids.has(admCode)) return;
  state.grids.set(admCode, { status: 'loading' });
  try {
    if (!/^27\d{6}$/.test(admCode)) throw new Error('행정동 코드가 올바르지 않습니다.');
    const response = await fetch(`data/grid/${admCode}.json`);
    if (!response.ok) throw new Error(`격자 자료 응답 ${response.status}`);
    state.grids.set(admCode, { status: 'ready', grid: validateGrid(await response.json(), state.dongIndex) });
  } catch (error) { state.grids.set(admCode, { status: 'error', message: error.message }); }
  renderDistribution();
}

function distributionSummary(view, industryName) {
  if (!view.top) return { headline: `이 동에는 수록된 ${industryName} 점포가 없습니다.`, top: '' };
  const first = view.top.cells[0]; const place = first.label ? `${first.label} 일대` : '도로명 없는 칸';
  return { headline: `${industryName} ${number.format(view.total)}곳이 ${number.format(view.occupied)}칸에 있습니다.`,
    top: view.top.cells.length > 1 ? `가장 많은 칸은 ${number.format(view.top.count)}곳이며 ${place} 등 ${view.top.cells.length}칸입니다.` : `가장 많은 칸은 ${place} ${number.format(view.top.count)}곳입니다.` };
}

function distributionChart(view, industryName, dongName) {
  const pitch = 12; const size = 10; const bar = scaleBar(view);
  const width = view.width * pitch; const height = view.height * pitch;
  const chart = svg('svg', { viewBox: `-1 -1 ${width + 2} ${height + 12}`, role: 'img', class: 'grid-chart' });
  const summary = distributionSummary(view, industryName);
  chart.setAttribute('aria-label', `${dongName} ${industryName} 분포. ${summary.headline} ${summary.top} 칸 하나는 약 ${view.cellMeters}미터입니다.`);
  // 칸 하나를 화면에서 20px까지 그리되, 넓은 동은 그림이 가로 300px·세로 420px를 넘지 않게 줄인다.
  const scale = Math.min(20, 300 / view.width, 420 / view.height);
  chart.style.maxWidth = `${Math.round(view.width * scale)}px`;
  // 다른 업종 점포만 있는 칸을 먼저 깔아 시가지 모양을 보이고, 고른 업종의 칸을 그 위에 놓는다.
  for (const cell of [...view.cells].sort((a, b) => a.count - b.count)) {
    const rect = svg('rect', { x: cell.x * pitch + 1, y: (view.height - 1 - cell.y) * pitch + 1, width: size, height: size, rx: 2 });
    rect.dataset.cell = `${cell.x}:${cell.y}`;
    const place = cell.label ? `${cell.label} 일대` : '도로명 없는 칸';
    if (cell.count > 0) {
      rect.setAttribute('class', `grid-cell bin-${binOf(cell.count) + 1}`);
      rect.dataset.tip = `${place}\n${industryName} ${number.format(cell.count)}곳 · 이 칸의 전체 점포 ${number.format(cell.total)}곳`;
    } else {
      rect.setAttribute('class', 'grid-context');
      rect.dataset.tip = `${place}\n${industryName} 없음 · 이 칸의 전체 점포 ${number.format(cell.total)}곳`;
    }
    chart.append(rect);
  }
  chart.append(svg('line', { x1: 1, y1: height + 6, x2: bar.cells * pitch - 1, y2: height + 6, class: 'grid-scale' }));
  return { chart, summary, bar };
}

function distributionTable(view, industryName) {
  const details = element('details', undefined, 'grid-table');
  details.append(element('summary', '표로 보기'));
  const rows = view.cells.filter(cell => cell.count >= 2).slice(0, 12);
  const ones = view.cells.filter(cell => cell.count === 1).length;
  const more = view.cells.filter(cell => cell.count >= 2).length - rows.length;
  if (rows.length) {
    const table = element('table');
    const head = element('tr'); head.append(element('th', '칸의 도로명'), element('th', '그림에서'), element('th', industryName), element('th', '전체 점포'));
    for (const th of head.children) th.scope = 'col';
    const thead = element('thead'); thead.append(head);
    const tbody = element('tbody');
    for (const cell of rows) { const tr = element('tr'); tr.dataset.cell = `${cell.x}:${cell.y}`; tr.append(element('td', cell.label ? `${cell.label} 일대` : '도로명 없는 칸'), element('td', sectorOf(view, cell)), element('td', `${number.format(cell.count)}곳`), element('td', `${number.format(cell.total)}곳`)); tbody.append(tr); }
    table.append(thead, tbody); details.append(table);
  }
  const rest = [more > 0 ? `2곳 이상인 칸이 ${number.format(more)}개 더 있습니다.` : '', ones ? `1곳인 칸은 ${number.format(ones)}개입니다.` : '', rows.length ? '' : (view.top ? '' : `${industryName} 점포가 있는 칸이 없습니다.`)].filter(Boolean).join(' ');
  if (rest) details.append(element('p', rest));
  return details;
}

/** 동 안에서의 분포. 내장 공개파일 집계를 보고 격자 자료가 있을 때만 그린다. */
function renderDistribution() {
  const box = $('distribution');
  const active = Boolean(state.gridsEnabled && state.dataset && canPickDongs());
  box.hidden = !active;
  $('grid-tooltip').hidden = true;
  if (!active) return;
  const slot = state.profile.industryId === 'food' ? 0 : 1;
  const code = industryCodes(state.dataset)[slot]; const industryName = state.dataset.analysis.industries[slot].name;
  $('distribution-intro').textContent = `색은 칸마다 수록된 ${industryName} 점포 수를 나타냅니다. 행정동마다 칸 크기와 축척이 다를 수 있습니다. 각 그림의 칸 크기를 먼저 확인하세요.`;
  $('distribution-legend').replaceChildren(...BINS.map((bin, position) => { const item = element('li', bin.label); item.prepend(element('span', undefined, `grid-swatch bin-${position + 1}`)); return item; }),
    (() => { const item = element('li', '다른 업종 점포만 있는 칸'); item.prepend(element('span', undefined, 'grid-swatch grid-context')); return item; })());
  $('distribution-charts').replaceChildren(...state.dataset.analysis.markets.map(market => {
    const card = element('article', undefined, 'grid-card');
    card.append(element('h4', market.name));
    const entry = state.grids.get(market.admCode);
    if (!entry) { loadGrid(market.admCode); card.append(element('p', '분포를 불러오는 중입니다.', 'grid-pending')); return card; }
    if (entry.status === 'loading') { card.append(element('p', '분포를 불러오는 중입니다.', 'grid-pending')); return card; }
    if (entry.status === 'error') { card.append(element('p', `분포를 보이지 못했습니다. ${entry.message}`, 'grid-pending')); return card; }
    const view = gridView(entry.grid, code);
    const { chart, summary, bar } = distributionChart(view, industryName, market.name);
    card.append(element('p', summary.headline, 'grid-headline'));
    if (summary.top) card.append(element('p', summary.top, 'grid-top'));
    card.append(chart, element('p', `칸 하나 약 ${number.format(view.cellMeters)}m · 아래 막대 약 ${number.format(bar.meters)}m · 위쪽이 북쪽`, 'grid-caption'), distributionTable(view, industryName));
    return card;
  }));
  $('distribution-note').textContent = '칸은 점포 좌표를 약 100m 격자로 묶은 것입니다. 지도 배경과 행정동 경계선은 없고, 그림의 축척은 동의 크기와 화면 폭에 따라 달라질 수 있어 그림마다 막대로 길이를 표시했습니다. 넓은 동은 이웃한 칸을 묶어 더 큰 칸으로 보입니다. 표의 ‘그림에서’는 점포가 있는 범위를 가로세로 셋으로 나눈 위치입니다. 도로명은 그 칸의 점포에 가장 흔한 것이며, 칸 전체가 그 길에 있다는 뜻은 아닙니다. 색 단계는 어느 동·어느 업종에서나 같습니다. 점포가 모여 있다는 것이 수요가 많다는 뜻은 아닙니다.';
}

let industryMode = null;
/** 고르기를 쓸 때는 원천의 모든 소분류를, 아니면 그 자료의 두 업종만 보인다. 고치는 중인 선택은 건드리지 않는다. */
function syncIndustryFields(picking, industries) {
  const mine = $('industry'); const other = $('industry-other');
  const mode = picking ? 'pick' : `fixed:${industries.map(item => `${item.id}=${item.name}`).join('|')}`;
  const rebuilt = industryMode !== mode;
  if (rebuilt) {
    if (picking) {
      const groups = () => groupCategories(state.dongIndex).map(group => {
        const optgroup = element('optgroup'); optgroup.label = group.major;
        optgroup.append(...group.categories.map(category => { const option = element('option', category.name); option.value = category.code; return option; }));
        return optgroup;
      });
      mine.replaceChildren(...groups()); other.replaceChildren(...groups());
    } else {
      mine.replaceChildren(...industries.map(item => { const option = element('option', item.name); option.value = item.id; return option; }));
      other.replaceChildren();
    }
    industryMode = mode;
  }
  $('industry-other-field').hidden = !picking;
  document.querySelector('#profile-form .form-grid').classList.toggle('picking', picking);
  $('profile-hint').textContent = picking
    ? `업종은 원천에서 관측된 상권업종 소분류 ${number.format(state.dongIndex.categories.length)}개 중에서 고릅니다. 목록은 분류표 순서입니다. 비용 가정은 업종별로 따로 보관합니다.`
    : '비용 입력도 이 조건을 기준으로 계산합니다. 업종별 비용 가정은 별도로 보관합니다.';
  if (rebuilt || !state.profileDirty) {
    if (picking) {
      const codes = industryCodes(state.dataset); const slot = state.profile.industryId === 'food' ? 0 : 1;
      mine.value = codes[slot]; other.value = codes[1 - slot];
    } else mine.value = state.profile.industryId;
  }
}

function dongPicker(row, slot) {
  const select = element('select', undefined, 'dong-pick');
  select.setAttribute('aria-label', `${row.name} 대신 비교할 행정동 고르기`);
  const placeholder = element('option', '다른 행정동으로 바꾸기');
  placeholder.value = ''; placeholder.selected = true;
  select.append(placeholder);
  const chosen = state.dataset.analysis.markets.map(market => market.admCode);
  for (const group of groupDongs(state.dongIndex)) {
    const optgroup = element('optgroup');
    optgroup.label = group.district;
    for (const dong of group.dongs) {
      const used = chosen.indexOf(dong.admCode);
      const option = element('option', used === slot ? `${dong.name} · 지금 보는 곳` : used >= 0 ? `${dong.name} · 다른 후보` : dong.name);
      option.value = dong.admCode; option.disabled = used >= 0;
      optgroup.append(option);
    }
    select.append(optgroup);
  }
  select.addEventListener('change', () => { if (select.value) pickDong(slot, select.value); });
  return select;
}

function pickDong(slot, admCode) {
  const codes = dongCodes(state.dataset);
  const before = state.dataset.analysis.markets[slot].name;
  codes[slot] = admCode;
  let next;
  try { next = datasetFromIndex(state.dongIndex, codes, industryCodes(state.dataset)); }
  catch (error) { status('pick-status', error.message, true); return; }
  const previous = currentCostScope();
  state.dataset = next; state.publicDataset = next;
  const scope = currentCostScope();
  const blank = !scope.applied && !scope.dirty && scope.draft.reserveManwon === ''
    && MARKETS.every(({ id }) => costFields.every(([key]) => scope.draft.markets[id][key] === ''));
  // 바꾸지 않은 후보의 비용 입력과 계산은 이어서 쓴다. 바꾼 자리는 빈칸으로 두고 0원으로 채우지 않는다.
  if (blank) {
    scope.draft.reserveManwon = previous.draft.reserveManwon;
    MARKETS.forEach(({ id }, position) => { if (position !== slot) scope.draft.markets[id] = { ...previous.draft.markets[id] }; });
    if (previous.applied) {
      scope.applied = { reserveManwon: previous.applied.reserveManwon, markets: Object.fromEntries(MARKETS.map(({ id }, position) =>
        [id, position === slot ? Object.fromEntries(costFields.map(([key]) => [key, null])) : { ...previous.applied.markets[id] }])) };
    }
    scope.dirty = previous.dirty;
  }
  render();
  const after = next.analysis.markets[slot];
  status('pick-status', `바꿨습니다: ${before} → ${findDong(state.dongIndex, after.admCode).district} ${after.name}. 이 자리의 비용은 새로 입력해 주세요.`);
  document.querySelector(`.market-card[data-market-id="${MARKETS[slot].id}"] .dong-pick`)?.focus();
}

function renderCosts(rows, industry) {
  const scope = currentCostScope();
  status('cost-review-status', '');
  $('cost-context').textContent = `적용 중: ${industry.name} · 예산 ${number.format(state.profile.budgetManwon)}만 원 · 목표 ${state.profile.months}개월`;
  status('cost-status', scope.dirty ? '수정한 비용은 아직 미적용입니다. ‘입력 비용으로 계산’을 눌러 주세요.' : scope.applied ? '현재 자료·업종의 적용된 비용 가정입니다.' : '');
  $('cost-form').toggleAttribute('data-dirty', scope.dirty);
  $('reserve').value = scope.draft.reserveManwon;
  $('cost-input-cards').replaceChildren(...rows.map(row => {
    const card = element('fieldset', undefined, 'cost-input-card');
    card.append(element('legend', row.name));
    for (const [key, label] of costFields) {
      const wrapper = element('label', label);
      const input = element('input');
      input.id = `cost-${row.marketId}-${key}`;
      input.type = 'number'; input.min = '0'; input.max = '10000000'; input.step = '1';
      input.inputMode = 'numeric'; input.placeholder = '미입력';
      input.value = scope.draft.markets[row.marketId][key];
      input.dataset.marketId = row.marketId; input.dataset.costKey = key;
      input.setAttribute('aria-label', `${row.name} ${label} (만 원)`);
      wrapper.append(input); card.append(wrapper);
    }
    return card;
  }));
  $('cost-result-cards').replaceChildren(...rows.map(row => {
    const assessment = assessCosts(state.profile, appliedCostPlan(row.marketId));
    const card = element('article', undefined, `cost-result-card ${assessment.status}`);
    card.dataset.marketId = row.marketId;
    card.append(element('h4', row.name), element('strong', costStatuses[assessment.status], 'cost-result-status'));
    if (assessment.status === 'incomplete') {
      card.append(element('p', '이 권역의 비용과 공통 유보금을 입력해 주세요. 빈칸을 0원으로 계산하지 않습니다.'));
    } else {
      const dl = element('dl');
      const values = [
        [`목표 ${state.profile.months}개월 필요액`, manwon(assessment.targetRequiredManwon), 'cost-key-value'],
        [assessment.targetGapManwon < 0 ? '추가 필요액' : '입력 비용 제외 잔액', manwon(Math.abs(assessment.targetGapManwon)), 'cost-gap'],
        ['초기 투입 후 가용액', manwon(assessment.availableAfterOpeningManwon)],
        ['입력 월 고정비', manwon(assessment.monthlyFixedManwon)],
        ['입력 고정비 충당', assessment.monthsCovered === null ? '산출 안 함 · 월 고정비 0' : `${number.format(assessment.monthsCovered)}개월분`],
      ];
      for (const [label, value, className] of values) {
        const div = element('div', undefined, className); div.append(element('dt', label), element('dd', value)); dl.append(div);
      }
      card.append(dl, element('p', '사용자 입력 가정 · 수익성이나 실제 존속기간을 뜻하지 않습니다.', 'footnote'));
    }
    return card;
  }));
}

function render() {
  const synthetic = state.dataset.kind === 'synthetic';
  const publicFile = state.dataset.kind === 'public-file';
  const analysis = state.dataset.analysis;
  $('dataset-notice').dataset.kind = state.dataset.kind;
  $('notice-title').textContent = synthetic ? '화면 확인용 가상 점포 자료' : publicFile ? '소상공인시장진흥공단 공개 점포 집계' : '사용자 제공 자료 · 원천 진위 미검증';
  const publicNote = state.flows.size && canPickDongs()
    ? '대구 행정동별 수록 점포입니다. ‘빠짐·새로’는 자료 목록의 변화이며, 실제 개업·폐업 여부는 별도로 확인해야 합니다.'
    : '대구 행정동별 수록 점포입니다. 현재 영업 상태와 수요는 별도로 확인해야 합니다.';
  $('notice-description').textContent = synthetic ? '후보 A·B·C의 공간 범위와 점포 수는 시연을 위한 가정입니다.' : publicFile ? publicNote : '출처와 기준일의 형식을 검사했습니다. 원본과 공간 범위는 별도로 확인이 필요합니다.';
  document.querySelector('.topbar .status-pill').textContent = synthetic ? '가상 데이터 데모' : publicFile ? '공개파일 집계' : '사용자 제공 자료';
  $('comparison-heading-text').textContent = analysis ? '권역별 경쟁환경 비교' : '상권별 경쟁환경 비교';
  const picking = canPickDongs();
  $('comparison-intro').textContent = picking ? '같은 기준일의 점포 수를 나란히 살펴보세요. 카드마다 대구의 다른 행정동으로 바꿀 수 있습니다.' : '같은 기준일의 점포 수를 나란히 살펴보세요.';
  $('reset-picks').hidden = !picking || dongCodes(state.dataset).join() === dongCodes(state.defaultPublicDataset).join();
  $('comparison-footnote').textContent = '비중 = 선택 업종 점포 수 ÷ 비교 업종 2개의 점포 수 합계. 전체 업종의 점유율이나 면적당 밀도가 아닙니다. ' + (analysis ? '권역은 원본의 행정동 코드로 구분한 개발안입니다. 서로 다른 면적의 점포 수를 성장성·사업기회 순위로 해석하지 마세요.' : '실제 공간 경계와 원천 분류는 미확정입니다.');
  const currentIndustries = getIndustries(state.dataset);
  syncIndustryFields(picking, currentIndustries);
  const industry = currentIndustries.find((item) => item.id === state.profile.industryId);
  $('comparison-label').textContent = industry.name;
  const rows = compareMarkets(state.dataset, state.profile.industryId);
  $('profile-form').toggleAttribute('data-dirty', state.profileDirty);
  $('cost-section').hidden = synthetic;
  $('cost-nav').hidden = synthetic;
  renderCosts(rows, industry);
  $('market-cards').replaceChildren(...rows.map((row, slot) => {
    const card = element('article', undefined, `market-card${row.marketId === state.selected ? ' selected' : ''}`);
    card.dataset.marketId = row.marketId;
    const dong = state.dongIndex && row.admCode ? findDong(state.dongIndex, row.admCode) : null;
    const top = element('div', undefined, 'card-top');
    top.append(element('h3', row.name), element('span', row.marketId === state.selected ? '근거 선택됨' : '', 'card-selection'));
    const count = element('div', number.format(row.count), 'count-number');
    count.append(element('span', '곳'));
    const changes = marketChanges(row);
    let changeLine = null;
    if (changes) {
      changeLine = element('ul', undefined, 'count-change');
      changeLine.append(...changes.map(entry => {
        const change = entry[state.profile.industryId];
        const item = element('li', change.status === 'ok'
          ? `${entry.asOf}${change.delta === 0 ? '과' : '보다'} ${changeWords(change)} · 그때 ${number.format(change.previous)}곳`
          : `${entry.asOf}과 비교 불가 · ${changeReason(change.status)}`);
        const flow = change.status === 'ok' && entry.flows ? entry.flows[state.profile.industryId] : null;
        if (flow) item.append(element('span', `남음 ${number.format(flow.kept)} · 빠짐 ${number.format(flow.out)} · 새로 ${number.format(flow.in)}`, 'count-flow'));
        return item;
      }));
    }
    const barLabel = element('div', undefined, 'bar-label');
    barLabel.append(element('span', `두 업종 ${number.format(row.count + row.otherCount)}곳 중 ${industry.name} 비중`), element('strong', row.share === null ? '산출 불가' : `${(row.share * 100).toFixed(1)}%`));
    const track = element('div', undefined, 'bar-track');
    const fill = element('div', undefined, 'bar-fill');
    fill.style.width = `${row.share === null ? 0 : row.share * 100}%`;
    track.append(fill);
    track.setAttribute('aria-hidden', 'true');
    const button = element('button', '검토 근거 보기', 'market-select');
    const arrow = element('span', '↘');
    arrow.setAttribute('aria-hidden', 'true');
    button.append(arrow);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(row.marketId === state.selected));
    button.setAttribute('aria-label', `${row.name} 검토 근거 보기`);
    button.addEventListener('click', () => {
      state.selected = row.marketId;
      render();
      status('form-status', `${row.name}의 검토 근거를 표시했습니다.`);
      $('strategy-title').tabIndex = -1;
      focusSection('strategy-title', 'strategy');
    });
    const other = currentIndustries.find((item) => item.id !== state.profile.industryId);
    const otherMeta = element('p', `${other.name} ${number.format(row.otherCount)}곳`, 'card-other');
    const date = element('time', state.dataset.source.asOf);
    date.setAttribute('datetime', state.dataset.source.asOf);
    const dateLine = element('span', '기준일 ', 'card-date');
    dateLine.append(date);
    otherMeta.append(dateLine);
    card.append(top, element('p', row.admCode ? `${dong && dong.name === row.name ? `${dong.district} · ` : ''}행정동 ${row.admCode}` : '공간 경계 미확정', 'area-note'));
    if (picking) card.append(dongPicker(row, slot));
    card.append(element('div', `${industry.name} 점포 수`, 'count-label'), count);
    if (changeLine) card.append(changeLine);
    card.append(barLabel, track, otherMeta, button);
    return card;
  }));
  const row = rows.find((item) => item.marketId === state.selected);
  const strategy = recommend(state.profile, row, synthetic ? undefined : appliedCostPlan(row.marketId));
  $('strategy-market').textContent = row.name;
  $('strategy-title').textContent = strategy.title;
  // 화면에는 요약을 먼저 보이고 계산 과정은 펼쳐 보게 한다. 저장하는 검토안 JSON에는 근거 전체가 그대로 들어간다.
  const reasons = splitReasons(strategy, { costsUnavailable: synthetic });
  $('strategy-reasons').replaceChildren(...reasons.summary.map((text) => element('li', text)));
  $('strategy-detail').hidden = reasons.detail.length === 0;
  $('strategy-detail-summary').textContent = `계산 과정 보기 (${reasons.detail.length}줄)`;
  $('strategy-detail-list').replaceChildren(...reasons.detail.map((text) => element('li', text)));
  $('strategy-checks').replaceChildren(...strategy.checks.map((text) => element('li', text)));
  $('data-kind').textContent = kindLabel();
  const source = state.dataset.source;
  const comparing = canCompareDates();
  $('comparison-footnote').textContent += comparing ? ` 변화는 이전 기준일(${state.previousIndexes.map(previous => previous.source.asOf).join(', ')})과 ${source.asOf}에 원천에 수록된 점포 수의 차이입니다. 개업·폐업 수가 아니며 원천의 정비·재분류가 섞일 수 있습니다.${state.flows.size ? ' 남음·빠짐·새로는 그 기준일과 지금의 점포를 상가업소번호로 맞춰 센 것입니다. 같은 상호·같은 도로명주소로 번호만 바뀐 곳은 남은 것으로 셉니다. 빠짐은 폐업이, 새로는 개업이 아닙니다.' : ''}` : '';
  const pairs = [['자료명', source.title], ['데이터 기준일', source.asOf], ['수집·생성일', source.retrievedAt], ['공간·집계 범위', source.scope], ['업종 분류판', source.classificationVersion], ['원문 출처', source.url || '실제 원천 자료 없음 · 화면 확인용 직접 생성']];
  if (comparing) pairs.push(['변화 비교 자료', state.previousIndexes.map(previous => `${previous.source.title} · 기준일 ${previous.source.asOf} · 수집 ${previous.source.retrievedAt}`).join(' / ')]);
  if (source.provider) pairs.push(['제공기관', source.provider]);
  if (source.license) pairs.push(['이용조건 기록', source.license]);
  $('source-details').replaceChildren(...pairs.map(([name, value]) => {
    const div = element('div');
    const dd = element('dd');
    if (name === '원문 출처' && source.url) {
      const a = element('a', value);
      a.href = source.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      dd.append(a);
    } else dd.textContent = value;
    div.append(element('dt', name), dd);
    return div;
  }));
  $('quality-summary').hidden = !analysis;
  $('quality-download').hidden = !publicFile;
  $('restore-public').hidden = !state.publicDataset || publicFile;
  if (analysis) {
    $('quality-counts').textContent = `원천 ${number.format(analysis.sourceRows)}행 · 중복 ID·필수값·좌표·분류 구조 검사 통과 기록`;
    $('quality-scope').textContent = `${analysis.completeScope} · 행정동 코드로 구분 · 분석 설정 버전 ${analysis.version}`;
    $('quality-hash').textContent = analysis.sourceSha256;
    $('quality-limit').textContent = '구조 검사는 원본의 현장 정확성이나 현재 영업 상태를 보장하지 않습니다. 가져온 자료의 검사 기록은 원본과 별도로 대조해야 합니다.';
  }
  renderDistribution();
  updateReview();
}

function readProfile(picking) {
  const profile = {
    // 고르기를 쓸 때는 희망 업종이 늘 첫째 자리(food)에 놓인다.
    industryId: picking ? 'food' : $('industry').value,
    budgetManwon: Number($('budget').value),
    months: Number($('months').value),
    goal: $('goal').value,
    risk: $('risk').value,
  };
  if (!Number.isSafeInteger(profile.budgetManwon) || profile.budgetManwon < 1 || profile.budgetManwon > 10000000) throw new Error('예산은 1~10,000,000만 원 범위의 정수로 입력해 주세요.');
  if (!Number.isInteger(profile.months) || profile.months < 1 || profile.months > 120) throw new Error('운영기간은 1~120개월 범위의 정수로 입력해 주세요.');
  return profile;
}

function makeReport() {
  const rows = compareMarkets(state.dataset, state.profile.industryId);
  const scenario = state.dataset.kind === 'synthetic' ? null : currentCostScope().applied;
  return {
    app: 'SHIFT LAB', version: '0.12.0', generatedAt: new Date().toISOString(),
    status: kindLabel(), datasetKind: state.dataset.kind,
    limitations: [state.dataset.analysis ? '행정동 기준 개발안 · 공인 상권 경계 아님 · 면적당 밀도 미산출' : '실제 상권·공간 경계 미확정', '비중의 분모는 비교하는 두 업종의 점포 수 합계', '종합 기회·위험 점수 및 Consumer Shift Velocity 미산출', '수요·임대료·개별 점포 비용 미확보', '규칙의 유용성과 추천 품질 미검증'],
    source: { ...state.dataset.source }, analysis: state.dataset.analysis || null, industries: getIndustries(state.dataset), profile: { ...state.profile },
    costScenario: { kind: 'user-input-assumptions', verified: false, industryId: state.profile.industryId,
      input: scenario, limitations: assessCosts(state.profile, undefined).limitations },
    changeBasis: canCompareDates() ? { kind: 'listed-store-count-difference', previousSources: state.previousIndexes.map(previous => ({ ...previous.source })),
      flowMatching: state.flows.size ? { ...[...state.flows.values()][0].matching, totals: Object.fromEntries([...state.flows].map(([asOf, flows]) => [asOf, { ...flows.totals }])) } : null,
      limitations: ['두 기준일에 원천에 수록된 점포 수의 차이', '개업·폐업 수가 아님', '원천의 정비·재분류가 섞일 수 있음', '한쪽에 행정동이나 분류가 없으면 0이 아니라 비교 불가', '빠짐은 폐업이 아니고 새로 수록은 개업이 아님'] } : null,
    comparisons: rows.map((row) => ({ ...row, changes: marketChanges(row), strategy: recommend(state.profile, row, scenario ? { ...scenario.markets[row.marketId], reserveManwon: scenario.reserveManwon } : undefined) })),
  };
}

function hasUnappliedEdits() {
  return state.profileDirty || (state.dataset.kind !== 'synthetic' && currentCostScope().dirty);
}

function focusSection(headingId, sectionId = headingId) {
  $(headingId).focus({ preventScroll: true });
  $(sectionId).scrollIntoView({ block: 'start' });
}

function updateReview() {
  if ($('review-panel').hidden) return;
  const blocked = hasUnappliedEdits();
  $('review-content').hidden = blocked;
  $('print-review').disabled = blocked;
  status('review-status', blocked ? '수정 중인 조건이나 비용을 비교·계산에 적용하면 검토안이 갱신됩니다.' : '', blocked);
  if (!blocked) {
    const labels = {
      goal: Array.from($('goal').options).find(option => option.value === state.profile.goal).textContent,
      risk: Array.from($('risk').options).find(option => option.value === state.profile.risk).textContent,
    };
    renderReview($('review-content'), makeReport(), labels, costFields);
  }
}

const reviewTriggers = [['view-review', 'data-status'], ['view-review-cost', 'cost-review-status']];
let reviewOrigin = 'view-review';

function setReviewOpen(open, trigger = reviewOrigin) {
  reviewOrigin = trigger;
  $('review-panel').hidden = !open;
  for (const [id] of reviewTriggers) $(id).setAttribute('aria-expanded', String(open));
  if (open) {
    delete document.body.dataset.printView;
    updateReview();
    focusSection('review-heading', 'review-panel');
  } else {
    $('review-content').hidden = true;
    const origin = $(reviewOrigin);
    (origin.closest('[hidden]') ? $('view-review') : origin).focus();
  }
}

async function start() {
  try {
    const response = await fetch('data/demo.json');
    if (!response.ok) throw new Error(`자료 응답 ${response.status}`);
    state.demo = validateDataset(await response.json());
    const catalogResponse = await fetch('data/catalog.json');
    if (!catalogResponse.ok) throw new Error('자료 목록을 읽지 못했습니다.');
    const catalog = await catalogResponse.json();
    if (!['demo.json', 'public-analysis.json'].includes(catalog.defaultDataset)) throw new Error('지원하지 않는 기본 자료입니다.');
    if (catalog.publicAvailable === true) {
      const publicResponse = await fetch('data/public-analysis.json');
      if (!publicResponse.ok) throw new Error('공개파일 집계 자료를 읽지 못했습니다.');
      state.publicDataset = validateDataset(await publicResponse.json());
      if (state.publicDataset.kind !== 'public-file') throw new Error('공개파일 집계 상태를 확인해 주세요.');
      state.defaultPublicDataset = state.publicDataset;
      if (catalog.dongIndex === 'dong-index.json') {
        // 색인을 못 읽어도 기본 세 권역 비교는 그대로 쓴다. 원본이 다른 색인은 섞지 않는다.
        try {
          const indexResponse = await fetch('data/dong-index.json');
          if (!indexResponse.ok) throw new Error(`색인 응답 ${indexResponse.status}`);
          const dongIndex = validateDongIndex(await indexResponse.json());
          if (dongIndex.kind !== 'public-file' || dongIndex.source.sha256 !== state.publicDataset.source.sha256) throw new Error('색인의 원본이 내장 공개파일 집계와 다릅니다.');
          state.dongIndex = dongIndex;
          state.gridsEnabled = catalog.dongGrids === 'grid';
          if (catalog.dongIndexHistory !== undefined) {
            // 이전 기준일 색인을 하나라도 못 읽으면 변화만 끈다. 일부만 견주지 않는다.
            try {
              const names = catalog.dongIndexHistory;
              if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || !/^dong-index-\d{6}\.json$/.test(name))) throw new Error('이전 기준일 색인 목록이 올바르지 않습니다.');
              const previousIndexes = [];
              for (const name of names) {
                const previousResponse = await fetch(`data/${name}`);
                if (!previousResponse.ok) throw new Error(`이전 기준일 색인 응답 ${previousResponse.status}`);
                const previousIndex = validateDongIndex(await previousResponse.json());
                if (previousIndex.kind !== 'public-file') throw new Error('이전 기준일 색인이 공개파일 집계가 아닙니다.');
                previousIndexes.push(previousIndex);
              }
              state.previousIndexes = orderHistory(dongIndex, previousIndexes);
              if (catalog.dongFlows !== undefined) {
                // 드나듦 자료를 하나라도 못 읽거나 색인과 맞지 않으면 드나듦만 끈다.
                try {
                  if (!Array.isArray(catalog.dongFlows) || catalog.dongFlows.some(name => typeof name !== 'string' || !/^dong-flows-\d{6}\.json$/.test(name))) throw new Error('드나듦 자료 목록이 올바르지 않습니다.');
                  const loaded = new Map();
                  for (const name of catalog.dongFlows) {
                    const flowsResponse = await fetch(`data/${name}`);
                    if (!flowsResponse.ok) throw new Error(`드나듦 자료 응답 ${flowsResponse.status}`);
                    const raw = await flowsResponse.json();
                    const previous = state.previousIndexes.find(index => index.source.asOf === raw?.previous?.asOf);
                    if (!previous) throw new Error('드나듦 자료에 맞는 이전 기준일 색인이 없습니다.');
                    loaded.set(previous.source.asOf, validateFlows(raw, dongIndex, previous));
                  }
                  state.flows = loaded;
                } catch (error) { console.warn(`드나듦 표시를 끕니다. ${error.message}`); }
              }
            } catch (error) { console.warn(`변화 비교를 끕니다. ${error.message}`); }
          }
        } catch (error) { console.warn(`행정동 고르기를 끕니다. ${error.message}`); }
      }
    }
    state.dataset = catalog.defaultDataset === 'public-analysis.json' ? state.publicDataset : state.demo;
    if (!state.dataset) throw new Error('기본 자료와 자료 목록이 맞지 않습니다.');
    render();
    mountPropertyWorkbench(state.dongIndex);
    mountExperiencePanel(state.dongIndex);
    $('app-loading').hidden = true;
    $('app-content').hidden = false;
    mountMobileNav();
  } catch (error) {
    $('app-loading').textContent = `자료를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요. 내 컴퓨터에서 볼 때는 프로젝트 폴더에서 npm run dev를 실행한 뒤 localhost 주소로 엽니다. (${error.message})`;
    return;
  }
  // 칸에 올리면 그 칸의 도로명과 수를 보인다. 같은 내용이 '표로 보기'에도 있다.
  const tooltip = $('grid-tooltip');
  $('distribution-charts').addEventListener('pointermove', event => {
    const tip = event.target instanceof SVGElement ? event.target.dataset.tip : undefined;
    if (!tip) { tooltip.hidden = true; return; }
    tooltip.replaceChildren(...tip.split('\n').map((line, position) => element(position ? 'span' : 'strong', line)));
    tooltip.hidden = false;
    const box = $('distribution').getBoundingClientRect();
    const left = Math.min(Math.max(event.clientX - box.left + 12, 0), box.width - tooltip.offsetWidth);
    tooltip.style.left = `${left}px`; tooltip.style.top = `${event.clientY - box.top + 14}px`;
  });
  $('distribution-charts').addEventListener('pointerleave', () => { tooltip.hidden = true; });
  // 표의 줄에 올리면 그림에서 그 칸을 짚어 준다.
  const linkCell = event => {
    const row = event.target instanceof Element ? event.target.closest('tr[data-cell]') : null;
    for (const marked of document.querySelectorAll('#distribution-charts .is-linked')) marked.classList.remove('is-linked');
    if (row && event.type === 'pointerover') row.closest('.grid-card').querySelector(`rect[data-cell="${row.dataset.cell}"]`)?.classList.add('is-linked');
  };
  $('distribution-charts').addEventListener('pointerover', linkCell);
  $('distribution-charts').addEventListener('pointerout', linkCell);
  $('profile-form').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const picking = canPickDongs();
      const next = readProfile(picking);
      let nextDataset = state.dataset;
      if (picking) {
        const codes = [$('industry').value, $('industry-other').value];
        if (codes[0] === codes[1]) throw new Error('희망 업종과 함께 비교할 업종을 서로 다르게 골라 주세요.');
        const current = industryCodes(state.dataset);
        if (state.profile.industryId !== 'food' || codes[0] !== current[0] || codes[1] !== current[1]) nextDataset = datasetFromIndex(state.dongIndex, dongCodes(state.dataset), codes);
      }
      // Validate rule inputs before replacing the last applied conditions.
      recommend(next, compareMarkets(nextDataset, next.industryId)[0]);
      const industryChanged = nextDataset !== state.dataset;
      if (industryChanged) { state.dataset = nextDataset; state.publicDataset = nextDataset; }
      state.profile = next;
      state.profileDirty = false;
      render();
      status('data-status', '');
      const names = nextDataset.analysis ? nextDataset.analysis.industries.map(industry => industry.name) : [];
      status('form-status', industryChanged
        ? `비교 업종을 바꿨습니다: ${names.join(' · ')}. 비용은 업종별로 따로 보관하므로 이 업종의 비용을 입력해 주세요.`
        : '입력한 조건으로 3개 후보의 검토안을 갱신했습니다.');
      focusSection('comparison-heading', 'comparison');
    } catch (error) { status('form-status', error.message, true); }
  });
  $('profile-form').addEventListener('input', () => {
    state.profileDirty = true;
    $('profile-form').toggleAttribute('data-dirty', true);
    status('form-status', '조건을 수정했습니다. ‘내 조건으로 비교’를 눌러 적용해 주세요.');
    updateReview();
  });
  $('cost-form').addEventListener('input', event => {
    const scope = currentCostScope();
    if (event.target.id === 'reserve') scope.draft.reserveManwon = event.target.value;
    else if (event.target.dataset.marketId && event.target.dataset.costKey) scope.draft.markets[event.target.dataset.marketId][event.target.dataset.costKey] = event.target.value;
    scope.dirty = true;
    $('cost-form').toggleAttribute('data-dirty', true);
    status('cost-status', '비용을 수정했습니다. ‘입력 비용으로 계산’을 눌러 적용해 주세요.');
    updateReview();
  });
  $('cost-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (state.profileDirty) throw new Error('상단 조건을 수정했다면 먼저 ‘내 조건으로 비교’를 눌러 적용해 주세요.');
      const scope = currentCostScope();
      const numeric = value => value === '' ? null : Number(value);
      const next = { reserveManwon: numeric(scope.draft.reserveManwon), markets: Object.fromEntries(MARKETS.map(({ id }) =>
        [id, Object.fromEntries(costFields.map(([key]) => [key, numeric(scope.draft.markets[id][key])]))])) };
      for (const { id } of MARKETS) assessCosts(state.profile, { ...next.markets[id], reserveManwon: next.reserveManwon });
      scope.applied = next;
      scope.dirty = false;
      render();
      status('data-status', '');
      status('cost-status', '현재 적용된 업종·예산·기간으로 비용을 계산했습니다. 미입력 권역은 계산을 보류합니다.');
      focusSection('cost-results-heading');
    } catch (error) { status('cost-status', error.message, true); }
  });
  $('clear-costs').addEventListener('click', () => {
    const scope = currentCostScope();
    scope.draft.reserveManwon = '';
    for (const { id } of MARKETS) for (const [key] of costFields) scope.draft.markets[id][key] = '';
    scope.applied = null;
    scope.dirty = false;
    render();
    status('data-status', '');
    status('cost-status', '현재 자료·업종의 비용 입력을 비웠습니다.');
  });
  $('dataset-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error('1MB 이하의 정규화 JSON 파일을 선택해 주세요.');
      const raw = JSON.parse(await file.text());
      if (raw && raw.kind === 'public-file') raw.kind = 'user-supplied';
      const dataset = validateDataset(raw);
      // Local imports never inherit the bundled public file's acquisition status.
      state.dataset = dataset;
      render();
      status('data-status', `${kindLabel()} 자료를 적용했습니다. 원천 자료의 진위는 별도로 확인해야 합니다.`);
    } catch (error) { status('data-status', `불러오지 못했습니다. 기존 자료를 유지합니다. ${error.message}`, true); }
    finally { event.target.value = ''; }
  });
  $('reset-demo').addEventListener('click', () => {
    state.dataset = state.demo;
    render();
    status('data-status', '가상 예시 자료로 돌아왔습니다.');
  });
  $('reset-picks').addEventListener('click', () => {
    const next = datasetFromIndex(state.dongIndex, dongCodes(state.defaultPublicDataset), industryCodes(state.dataset));
    state.dataset = next; state.publicDataset = next;
    render();
    status('pick-status', '처음의 세 행정동으로 돌아왔습니다.');
    focusSection('comparison-heading', 'comparison');
  });
  $('restore-public').addEventListener('click', () => {
    if (!state.publicDataset) return;
    state.dataset = state.publicDataset;
    render();
    status('data-status', '프로젝트에 포함된 공개파일 집계로 돌아왔습니다.');
  });
  for (const [triggerId, statusId] of reviewTriggers) {
    $(triggerId).addEventListener('click', () => {
      const open = $('review-panel').hidden;
      if (open && hasUnappliedEdits()) {
        status(statusId, '수정 중인 조건이나 비용이 있습니다. 비교·계산에 적용한 뒤 검토안을 열어 주세요.', true);
        return;
      }
      status(statusId, '');
      setReviewOpen(open, triggerId);
    });
  }
  $('close-review').addEventListener('click', () => setReviewOpen(false));
  $('print-review').addEventListener('click', () => {
    if (!hasUnappliedEdits()) {
      delete document.body.dataset.printView;
      window.print();
    }
  });
  $('export-report').addEventListener('click', () => {
    if (hasUnappliedEdits()) {
      status('data-status', '수정 중인 조건이나 비용이 있습니다. 비교·계산에 적용한 뒤 저장해 주세요.', true);
      return;
    }
    const blob = new Blob([JSON.stringify(makeReport(), null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = element('a');
    a.href = url;
    a.download = `SHIFT-review-${state.dataset.source.asOf}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('data-status', '현재 적용된 조건과 자료 상태를 담은 검토안 JSON 저장을 요청했습니다.');
  });
}

start();
