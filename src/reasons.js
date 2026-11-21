const COSTS_UNAVAILABLE = '가상 예시에는 비용 검토를 제공하지 않습니다. 공개파일 집계로 돌아가면 비용을 입력할 수 있습니다.';

/**
 * 검토 근거를 먼저 보일 요약과 펼쳐 볼 계산 과정으로 나눈다. 문장을 새로 만들거나 고치지 않고 순서만 정한다.
 * recommend()의 reasons는 규칙 근거 뒤에 assessCosts()의 reasons가 이어지고,
 * 비용 근거는 [입력 전제, 제외 범위, ...계산 단계, 결론] 순서다. 이 순서는 tests/reasons.test.mjs가 잠근다.
 */
export function splitReasons(strategy, { costsUnavailable = false } = {}) {
  const all = strategy.reasons;
  const cost = strategy.costs.reasons;
  const start = all.length - cost.length;
  const aligned = start >= 0 && cost.every((text, index) => all[start + index] === text);
  // 순서를 확인할 수 없으면 숨기는 것 없이 전부 보인다.
  if (!aligned) return { summary: [...all], detail: [] };
  const rules = all.slice(0, start);
  if (strategy.costs.status === 'incomplete') {
    // 가상 예시에서는 비용 입력란을 숨기므로, 숨긴 항목을 입력하라는 안내 대신 그 사실을 알린다.
    return { summary: costsUnavailable ? [...rules, ...cost.slice(0, -1), COSTS_UNAVAILABLE] : [...all], detail: [] };
  }
  const [premise, exclusion, ...rest] = cost;
  const conclusion = rest.pop();
  return { summary: [...rules, conclusion, exclusion], detail: [premise, ...rest] };
}
