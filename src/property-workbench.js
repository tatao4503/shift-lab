import { defaultIndustryCodes, groupDongs, groupCategories } from './dongs.js';
import { MAX_PROPERTY_DRAFT_BYTES, downloadPropertyDraft, parsePropertyDraft } from './property-draft.js';
import { PROPERTY_EVIDENCE, assessProperties } from './properties.js';
import { renderPropertyReview } from './property-review.js';

const slots = ['a', 'b', 'c'];
const terms = ['industryCode', 'budgetManwon', 'months', 'reserveManwon'];
const costFields = ['depositManwon', 'setupManwon', 'monthlyRentManwon', 'monthlyOtherFixedManwon'];
const propertyFields = ['name', 'admCode', ...costFields, 'evidence', 'quoteDate', 'followUp'];

function setGroups(select, groups) {
  select.append(...groups.map(([name, pairs]) => {
    const group = document.createElement('optgroup');
    group.label = name;
    group.append(...pairs.map(([value, label]) => new Option(label, value)));
    return group;
  }));
}

function exampleProperty(name, amounts, followUp) {
  return {
    name,
    admCode: '27110565',
    ...Object.fromEntries(costFields.map((key, index) => [key, amounts[index]])),
    evidence: 'assumption',
    quoteDate: '',
    followUp,
  };
}

export function mountPropertyWorkbench(index) {
  const form = document.getElementById('property-form');
  const get = id => document.getElementById(`property-${id}`);
  if (!index) {
    get('unavailable').hidden = false;
    return;
  }

  const industry = get('industry');
  setGroups(industry, groupCategories(index).map(group => [
    group.major,
    group.categories.map(category => [category.code, category.name]),
  ]));
  industry.value = defaultIndustryCodes(index)[0];

  const locations = groupDongs(index).map(group => [
    group.district,
    group.dongs.map(dong => [dong.admCode, dong.name]),
  ]);
  const entries = slots.map(slot => {
    const card = get('entry-template').content.firstElementChild.cloneNode(true);
    card.id = `property-entry-${slot}`;
    card.querySelector('legend').textContent = `매물 ${slot.toUpperCase()}`;
    const area = card.querySelector('[name="admCode"]');
    area.append(new Option('행정동 선택', ''));
    setGroups(area, locations);

    const evidence = card.querySelector('[name="evidence"]');
    evidence.append(...Object.entries(PROPERTY_EVIDENCE).map(([value, label]) => new Option(label, value)));
    for (const control of card.querySelectorAll('[name]')) {
      control.id = `property-${slot}-${control.name}`;
      control.name = `${slot}-${control.name}`;
    }
    return card;
  });

  const third = entries[2];
  const toggleThird = get('toggle-third');
  const review = get('review');
  const content = get('review-content');
  const fileInput = get('draft-file');
  const feedback = get('feedback');
  const readyCount = get('ready-count');
  const sourceArea = () => get('a-admCode').value;
  const activeSlots = () => third.hidden ? slots.slice(0, 2) : slots;
  const named = key => form.elements.namedItem(key);

  function setThirdIncluded(include) {
    third.hidden = !include;
    third.disabled = !include;
    toggleThird.setAttribute('aria-expanded', String(include));
    toggleThird.textContent = include ? '매물 C 제외' : '매물 C 추가';
  }

  function readFields(keys, prefix = '') {
    return Object.fromEntries(keys.map(key => [key, named(prefix + key).value]));
  }

  function getDraft() {
    return {
      includeThird: !third.hidden,
      common: readFields(terms),
      properties: Object.fromEntries(slots.map(slot => [slot, readFields(propertyFields, slot + '-')])),
    };
  }

  function announce(message, error = false) {
    const status = get('status');
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function announceFeedback(message, error = false) {
    feedback.textContent = message;
    feedback.classList.toggle('error', error);
  }

  function clearReview() {
    if (review.hidden) return;
    review.hidden = true;
    content.replaceChildren();
    if (document.body.dataset.printView === 'property') delete document.body.dataset.printView;
    announce('입력이 바뀌었습니다. 매물 비용 비교를 다시 눌러 반영하세요.');
  }

  function updateReadiness() {
    let complete = 0;
    for (const [index, slot] of slots.entries()) {
      const card = entries[index];
      const status = card.querySelector('.property-entry-status');
      const borrowedArea = card.querySelector('.property-borrow-area');
      const filled = costFields.filter(key => {
        const input = get(`${slot}-${key}`);
        return input.validity.valid && /^\d+$/.test(input.value);
      }).length;
      const ready = filled === costFields.length;
      status.textContent = ready ? '비용 입력 완료' : `비용 ${filled}/${costFields.length} 입력`;
      status.dataset.ready = String(ready);
      borrowedArea.disabled = !sourceArea() || get(`${slot}-admCode`).value === sourceArea();
      if (ready && !card.hidden) complete += 1;
    }
    if (readyCount) readyCount.textContent = `비용 입력 완료 ${complete}/${activeSlots().length}`;
  }

  function syncEdits() {
    clearReview();
    updateReadiness();
  }

  setThirdIncluded(false);
  get('entries').replaceChildren(...entries);
  form.hidden = false;
  updateReadiness();
  const initialDraft = getDraft();

  function restoreDraft(draft) {
    for (const [key, value] of Object.entries(draft.common)) named(key).value = value;
    for (const [i, slot] of slots.entries()) {
      const property = draft.properties[slot];
      for (const [key, value] of Object.entries(property)) named(slot + '-' + key).value = value;
      entries[i].querySelector('.property-entry-details').open = (
        Boolean(property.quoteDate || property.followUp)
        || (property.evidence !== '' && property.evidence !== 'unknown')
      );
    }
    setThirdIncluded(draft.includeThird);
    syncEdits();
  }

  function confirmReplacement(draft, message) {
    const current = JSON.stringify(getDraft());
    return current === JSON.stringify(initialDraft) || current === JSON.stringify(draft) || window.confirm(message);
  }

  function onFieldEdit(event) {
    if (event.target.name && event.target !== fileInput) syncEdits();
  }

  form.addEventListener('input', onFieldEdit);
  form.addEventListener('change', onFieldEdit);
  form.addEventListener('invalid', event => {
    const details = event.target.closest('details');
    if (details) details.open = true;
  }, true);

  for (const [index, slot] of slots.entries()) {
    const button = entries[index].querySelector('.property-borrow-area');
    button.hidden = slot === 'a';
    button.setAttribute('aria-label', `A와 같은 동을 매물 ${slot.toUpperCase()}에 적용`);
    button.addEventListener('click', () => {
      const area = get(`${slot}-admCode`);
      area.value = sourceArea();
      syncEdits();
      area.focus();
      announce(`매물 ${slot.toUpperCase()}의 행정동을 매물 A와 같게 설정했습니다.`);
    });
  }

  toggleThird.addEventListener('click', () => {
    setThirdIncluded(third.hidden);
    syncEdits();
    if (!third.hidden) get('c-name').focus();
  });

  get('load-example').addEventListener('click', () => {
    const example = {
      includeThird: false,
      common: { industryCode: 'I21201', budgetManwon: '5000', months: '6', reserveManwon: '500' },
      properties: {
        a: exampleProperty('가상 예시 A', ['1000', '2000', '150', '150'], '관리비에 부가세가 포함되는지 확인'),
        b: exampleProperty('가상 예시 B', ['800', '1500', '100', '150'], ''),
        c: initialDraft.properties.c,
      },
    };
    if (!confirmReplacement(example, '현재 입력을 가상 예시로 바꿀까요?')) return;
    restoreDraft(example);
    announceFeedback('가상 매물 예시를 채웠습니다. 매물 비용 비교를 눌러 결과를 확인하세요.');
  });

  get('save-draft').addEventListener('click', () => {
    try {
      downloadPropertyDraft(getDraft());
      announceFeedback('매물 입력 파일을 다운로드합니다.');
    } catch (error) {
      announceFeedback(error.message, true);
    }
  });

  get('load-draft').addEventListener('click', () => fileInput.click());
  let loadAttempt = 0;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = '';
    const attempt = ++loadAttempt;
    try {
      if (file.size > MAX_PROPERTY_DRAFT_BYTES) throw new Error('매물 입력 파일은 32KB 이하만 불러올 수 있습니다.');
      const text = await file.text();
      if (attempt !== loadAttempt) return;
      const draft = parsePropertyDraft(text, index);
      if (!confirmReplacement(draft, '현재 입력을 파일에 저장된 내용으로 바꿀까요?')) {
        announceFeedback('파일 불러오기를 취소했습니다.');
        return;
      }
      restoreDraft(draft);
      announceFeedback('저장한 매물 입력을 불러왔습니다. 매물 비용 비교를 눌러 결과를 확인하세요.');
    } catch (error) {
      if (attempt === loadAttempt) announceFeedback(error.message, true);
    }
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const { common, properties } = getDraft();
    try {
      const report = assessProperties(index, { ...common, properties: activeSlots().map(slot => properties[slot]) });
      renderPropertyReview(content, report);
      review.hidden = false;
      document.body.dataset.printView = 'property';
      const incomplete = report.properties.some(property => property.costs.status === 'incomplete');
      announce(incomplete ? '일부 비용 입력이 필요합니다. 검토안에서 비어 있는 항목을 확인하세요.' : '입력한 조건으로 매물 비용을 계산했습니다.');
      get('review-heading').focus({ preventScroll: true });
      review.scrollIntoView({ block: 'start' });
    } catch (error) {
      clearReview();
      announce(error.message, true);
    }
  });

  get('edit').addEventListener('click', () => get('budget').focus());
  get('print').addEventListener('click', () => {
    if (review.hidden) return;
    document.body.dataset.printView = 'property';
    window.print();
  });
}
