import { defaultIndustryCodes, groupCategories, groupDongs } from './dongs.js';
import { EXPERIENCE_ITEMS, EXPERIENCE_SETUP, MAX_EXPERIENCE_BYTES, appendExperience, demoExperienceFile, emptyExperienceFile,
  parseExperienceFile, serializeExperienceFile, summarizeExperiences } from './experiences.js';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function groups(select, list) {
  select.append(...list.map(([name, pairs]) => {
    const group = document.createElement('optgroup');
    group.label = name;
    group.append(...pairs.map(([value, label]) => new Option(label, value)));
    return group;
  }));
}

function choices(container, name, type, entries, checked) {
  container.append(...entries.map(([value, label]) => {
    const wrap = element('label', undefined, 'experience-choice');
    const input = document.createElement('input');
    input.type = type; input.name = name; input.value = value; input.checked = value === checked;
    wrap.append(input, element('span', label));
    return wrap;
  }));
}

/** 수를 읽는 말. 0명인 쪽은 적지 않는다. */
function countText(parts) { return parts.filter(([, count]) => count > 0).map(([label, count]) => `${label} ${count}명`).join(' · '); }

export function mountExperiencePanel(index) {
  const section = document.getElementById('experience-section');
  if (!section || !index) return;
  const get = id => document.getElementById(`experience-${id}`);
  const form = get('form');
  const view = get('view-industry');
  const box = get('summary');
  const hint = document.getElementById('property-review-experience');
  const propertyIndustry = document.getElementById('property-industry');
  const propertyReview = document.getElementById('property-review');
  const fileInput = get('file');

  let file = emptyExperienceFile();   // 실제로 모은 기록
  let demo = null;                     // 가상 예시를 보는 동안에만 있다
  let unsaved = 0;

  const categories = groupCategories(index).map(group => [group.major, group.categories.map(category => [category.code, category.name])]);
  groups(view, categories);
  groups(get('industry'), categories);
  view.value = get('industry').value = defaultIndustryCodes(index)[0];
  get('district').append(new Option('말하지 않음', ''), ...groupDongs(index).map(group => new Option(group.district, group.districtCode)));
  choices(get('missed'), 'missed', 'checkbox', Object.entries(EXPERIENCE_ITEMS));
  choices(get('setup'), 'setup', 'radio', Object.entries(EXPERIENCE_SETUP), 'unknown');
  choices(get('would-check'), 'wouldCheck', 'checkbox', Object.entries(EXPERIENCE_ITEMS));

  const industryName = code => index.categories.find(item => item.code === code)?.name || '';
  function announce(message, error = false) {
    const status = get('feedback');
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function renderSummary() {
    const current = demo ?? file;
    const name = industryName(view.value);
    const summary = summarizeExperiences(current, view.value);
    section.dataset.kind = current.kind;
    get('kind').textContent = demo ? '가상 예시' : file.records.length ? `모은 기록 ${file.records.length}건` : '기록 없음';
    get('example').textContent = demo ? '가상 예시 닫기' : '가상 예시 보기';
    get('example').setAttribute('aria-pressed', String(Boolean(demo)));
    get('save').disabled = file.records.length === 0;
    get('unsaved').textContent = unsaved ? `저장하지 않은 기록 ${unsaved}건 · 페이지를 닫으면 사라집니다.` : '';

    const nodes = [];
    if (demo) nodes.push(element('p', '가상 예시입니다. 실제로 누가 한 말이 아니며, 화면이 어떻게 보이는지 확인하는 용도입니다.', 'experience-demo-note'));
    if (!summary.total) {
      nodes.push(element('p', '아직 모은 경험이 없습니다. ‘기록 더하기’로 적거나, 저장해 둔 기록 파일을 불러오세요.', 'experience-empty'));
    } else if (!summary.matched) {
      nodes.push(element('p', `${name} 기록은 아직 없습니다. 다른 업종의 기록이 ${summary.others}건 있습니다.`, 'experience-empty'));
    } else {
      nodes.push(element('h3', `${name} · 닫아 본 ${summary.matched}명의 기록`));
      if (summary.items.length) {
        const list = element('ol', undefined, 'experience-items');
        list.append(...summary.items.map(item => {
          const row = element('li');
          row.append(element('strong', item.label), element('span', countText([['놓쳤다', item.missed], ['다시 한다면 확인', item.wouldCheck]])));
          return row;
        }));
        nodes.push(list);
      }
      const setup = countText(Object.entries(EXPERIENCE_SETUP).map(([key, label]) => [label, summary.setup[key]]));
      if (setup) nodes.push(element('p', `처음 예상한 초기비와 견주어: ${setup}`, 'experience-setup'));
      if (summary.notes.length) {
        const notes = element('ul', undefined, 'experience-notes');
        notes.append(...summary.notes.map(note => { const row = element('li', note.text); row.append(element('span', note.id)); return row; }));
        nodes.push(element('h4', '남긴 말'), notes);
      }
      const tail = [];
      if (summary.compensated) tail.push(`사례비를 드리고 받은 기록 ${summary.compensated}건.`);
      if (summary.others) tail.push(`다른 업종의 기록 ${summary.others}건은 여기 세지 않았습니다.`);
      tail.push('기록한 분들의 말을 센 것입니다. 폐업의 원인이나 확률을 뜻하지 않으며, 금액과 가게를 알 수 있는 내용은 담지 않습니다.');
      nodes.push(element('p', tail.join(' '), 'footnote'));
    }
    box.replaceChildren(...nodes);
    renderHint();
  }

  // 매물 검토안 아래에 짧게 알린다. 그 업종의 기록이 있을 때만, 화면에서만(인쇄에는 넣지 않는다).
  function renderHint() {
    if (!hint) return;
    const current = demo ?? file;
    const code = propertyIndustry?.value;
    const summary = code ? summarizeExperiences(current, code) : null;
    const top = summary?.items.filter(item => item.missed > 0).slice(0, 3) ?? [];
    if (!summary || propertyReview?.hidden || !top.length) { hint.hidden = true; hint.replaceChildren(); return; }
    const link = element('a', '전체 보기');
    link.href = '#experience-section';
    const list = element('ul');
    list.append(...top.map(item => element('li', `${item.label} ${item.missed}명`)));
    hint.replaceChildren(
      element('h4', `${demo ? '가상 예시 · ' : ''}${industryName(code)} · 먼저 닫아 본 ${summary.matched}명이 놓쳤다고 한 것`),
      list,
      element('p', '견적을 받을 때 이 항목이 들어 있는지 물어보세요. 사람 수이며 폐업의 원인이나 확률이 아닙니다. '),
    );
    hint.lastElementChild.append(link);
    hint.hidden = false;
  }

  view.addEventListener('change', renderSummary);
  propertyIndustry?.addEventListener('change', () => { if (index.categories.some(item => item.code === propertyIndustry.value)) view.value = propertyIndustry.value; renderSummary(); });
  if (propertyReview) new MutationObserver(renderHint).observe(propertyReview, { attributeFilter: ['hidden'] });

  get('example').addEventListener('click', () => {
    demo = demo ? null : demoExperienceFile(index, view.value);
    announce(demo ? '가상 예시를 보여 줍니다. 모은 기록은 그대로 있습니다.' : '가상 예시를 닫았습니다.');
    renderSummary();
  });

  get('save').addEventListener('click', () => {
    try {
      const blob = new Blob([serializeExperienceFile(file, index)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'SHIFT-경험-기록.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      unsaved = 0;
      announce(`경험 기록 ${file.records.length}건을 파일로 내려받습니다. 본인 기기에 보관하세요.`);
      renderSummary();
    } catch (error) { announce(error.message, true); }
  });

  get('load').addEventListener('click', () => fileInput.click());
  let attempt = 0;
  fileInput.addEventListener('change', async () => {
    const picked = fileInput.files?.[0];
    if (!picked) return;
    fileInput.value = '';
    const mine = ++attempt;
    try {
      if (picked.size > MAX_EXPERIENCE_BYTES) throw new Error('경험 기록 파일은 256KB 이하만 불러올 수 있습니다.');
      const loaded = parseExperienceFile(await picked.text(), index);
      if (mine !== attempt) return;
      if (loaded.kind !== 'collected') throw new Error('가상 예시 파일은 불러오지 않습니다.');
      if (unsaved && !window.confirm(`저장하지 않은 기록 ${unsaved}건이 있습니다. 파일의 기록으로 바꿀까요?`)) { announce('파일 불러오기를 취소했습니다.'); return; }
      file = loaded; demo = null; unsaved = 0;
      announce(`경험 기록 ${file.records.length}건을 불러왔습니다.`);
      renderSummary();
    } catch (error) { if (mine === attempt) announce(error.message, true); }
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const now = new Date();
    try {
      const next = appendExperience(file, {
        industryCode: data.get('industryCode'), districtCode: data.get('districtCode'),
        recordedMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
        missed: data.getAll('missed'), missedNote: data.get('missedNote'),
        setup: data.get('setup'), wouldCheck: data.getAll('wouldCheck'), wouldCheckNote: data.get('wouldCheckNote'),
        consent: data.get('consent') === 'on', compensated: data.get('compensated') === 'on',
      }, index);
      const kept = { industryCode: data.get('industryCode'), districtCode: data.get('districtCode') };
      file = next; demo = null; unsaved += 1;
      form.reset();
      get('industry').value = kept.industryCode; get('district').value = kept.districtCode;
      view.value = kept.industryCode;
      announce(`기록을 더했습니다(번호 ${file.records.at(-1).id}). ‘기록 저장’으로 파일에 남기세요.`);
      renderSummary();
      get('heading').focus({ preventScroll: true });
      section.scrollIntoView({ block: 'start' });
    } catch (error) { announce(error.message, true); }
  });

  section.hidden = false;
  const nav = document.getElementById('experience-nav');
  if (nav) nav.hidden = false;
  renderSummary();
}
