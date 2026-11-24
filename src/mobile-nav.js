const targets = [
  ['property-section', 'property-heading'],
  ['property-review', 'property-review-heading'],
  ['comparison', 'comparison-heading'],
  ['data', 'data-heading'],
];

export function mountMobileNav() {
  const nav = document.getElementById('mobile-nav');
  const note = document.getElementById('mobile-nav-note');
  const form = document.getElementById('property-form');
  if (!nav || !note || !form) return;

  const entries = targets.map(([id, headingId]) => ({
    id,
    section: document.getElementById(id),
    heading: document.getElementById(headingId),
    link: nav.querySelector(`a[data-mobile-section="${id}"]`),
  }));
  if (entries.some(({ section, heading, link }) => !section || !heading || !link)) return;

  const [property, review] = entries;
  const narrow = window.matchMedia('(max-width: 690px)');
  const header = document.querySelector('.site-header');
  let activeLink;
  let frame;

  function hasReview() {
    return !form.hidden && !review.section.hidden;
  }

  function syncReviewLink() {
    const ready = hasReview();
    review.link.setAttribute('href', ready ? '#property-review' : '#property-section');
    if (ready) note.textContent = '';
  }

  function updateCurrent() {
    frame = undefined;
    const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
    const margin = Number.parseFloat(getComputedStyle(property.section).scrollMarginTop) || 0;
    const activationLine = Math.max(headerBottom, margin) + 20;
    const navTop = nav.getBoundingClientRect().top;
    const entry = entries.findLast(item => {
      if (item.section.hidden) return false;
      const { top, bottom } = item.section.getBoundingClientRect();
      if (item === review && (!hasReview() || bottom <= headerBottom || top >= navTop)) return false;
      return top <= activationLine;
    }) ?? property;
    if (activeLink !== entry.link) {
      activeLink?.removeAttribute('aria-current');
      entry.link.setAttribute('aria-current', 'location');
      activeLink = entry.link;
    }
  }

  function scheduleCurrent() {
    if (narrow.matches && frame === undefined) frame = requestAnimationFrame(updateCurrent);
  }

  for (const entry of entries) {
    entry.link.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      syncReviewLink();
      const needsInput = entry === review && !hasReview();
      const target = needsInput ? property : entry;
      if (needsInput) {
        note.textContent = form.hidden
          ? '지금은 매물 비교를 열 수 없습니다.'
          : '매물 비용 비교를 누르면 검토안이 열립니다.';
      } else {
        note.textContent = '';
      }
      // Fragment links keep browser history and honor the page's scroll settings.
      requestAnimationFrame(() => target.heading.focus({ preventScroll: true }));
    });
  }

  // 안내는 비교를 누르는 순간, 검토안으로 옮겨 가기 전에 지운다. 옮긴 뒤에 지우면 안내의 높이만큼 화면이 밀려
  // 검토안 머리가 상단 바 밑으로 들어간다(스크롤 보정이 없는 Safari, 부드러운 스크롤 중인 Chrome).
  document.addEventListener('submit', event => { if (event.target === form) note.textContent = ''; }, true);

  syncReviewLink();
  nav.hidden = false;
  scheduleCurrent();
  window.addEventListener('scroll', scheduleCurrent, { passive: true });
  window.addEventListener('resize', scheduleCurrent);
  window.addEventListener('hashchange', scheduleCurrent);
  const reviewState = new MutationObserver(() => {
    syncReviewLink();
    scheduleCurrent();
  });
  reviewState.observe(review.section, { attributeFilter: ['hidden'] });
}
