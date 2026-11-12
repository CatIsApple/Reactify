import { test, expect } from '@playwright/test';

test('DOM editing, history navigation, no-op and keyed reordering', async ({ page }) => {
  await page.goto('/#lab');
  const original = await page.locator('#actual h2').elementHandle();
  await page.getByLabel('실험 예제', { exact: true }).selectOption('text');
  await page.getByRole('button', { name: 'Patch 적용' }).click();
  await expect(page.locator('#actual h2')).toHaveText('오늘도, 한 단계 성장.');
  expect(await original!.evaluate((node) => node === document.querySelector('#actual h2'))).toBe(
    true,
  );
  await expect(page.locator('#metric-changes')).toHaveText('1operations');
  await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
  await expect(page.locator('#actual h2')).toHaveText('조금씩, 더 나은 코드.');
  await page.getByRole('button', { name: '앞으로가기', exact: true }).click();
  await expect(page.locator('#source')).toHaveValue(/오늘도, 한 단계 성장/);
  await page.getByRole('button', { name: 'Patch 적용' }).click();
  await expect(page.locator('#metric-changes')).toHaveText('0operations');
  const first = await page.locator('#actual [data-key="vdom"]').elementHandle();
  await page.getByLabel('실험 예제', { exact: true }).selectOption('reorder');
  await page.getByRole('button', { name: 'Patch 적용' }).click();
  expect(
    await first!.evaluate((node) => node === document.querySelector('#actual [data-key="vdom"]')),
  ).toBe(true);
  await expect(page.locator('#actual li').first()).toHaveAttribute('data-key', 'patch');
});

test('task board events, memo reuse, batching and persistence', async ({ page }) => {
  await page.goto('/#hooks');
  await expect(page.locator('#fiber-stats')).toContainText('COMMITS');
  const trace = page.locator('#execution-steps');
  const summary = page.locator('#execution-summary');
  const batchButton = page.getByRole('button', { name: '+3 한 번에', exact: true });
  const batchResult = page.locator('.batch-card #batch-result');
  await expect(page.locator('#execution-title')).toHaveText('작업 추가 후 실행 흐름');
  await batchButton.click();
  await expect(page.locator('#batch-value')).toHaveText('3');
  await expect(batchResult).toHaveText('상태 변경 요청 3개 · 커밋 1회');
  await expect(summary).toContainText('작업을 추가하면');
  await expect(trace).toBeHidden();
  await page.getByLabel('새 작업', { exact: true }).fill('E2E task');
  await expect(page.getByLabel('새 작업', { exact: true })).toHaveValue('E2E task');
  await page.getByRole('button', { name: '+ 추가', exact: true }).click();
  await expect(page.locator('.task-recent')).toContainText('E2E task');
  await expect(page.getByLabel('새 작업', { exact: true })).toHaveValue('');
  await expect(trace.getByRole('heading')).toHaveText([
    'useState',
    'useMemo',
    'Props',
    'Diff · Patch',
    'useEffect',
  ]);
  await expect(trace).toContainText('작업 4 → 5개');
  await expect(trace).toContainText('TaskRow에 “E2E task” 전달');
  await expect(trace).toContainText('브라우저에 저장됨');
  await trace.getByText(/실제 Patch 작업/).click();
  await expect(trace.getByText(/CREATE · .* · li/)).toBeVisible();
  const afterAdd = await page.locator('#fiber-stats > div').first().locator('strong').textContent();
  await page.getByRole('button', { name: '단계별 보기' }).click();
  await expect(page.getByRole('button', { name: '이전', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(trace.locator('[aria-current="step"]')).toContainText('useMemo');
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await expect(trace.locator('[aria-current="step"]')).toContainText('useState');
  await expect(page.locator('#fiber-stats > div').first().locator('strong')).toHaveText(afterAdd!);
  await page.goto('/#lab');
  await expect(page.locator('#actual')).toBeVisible();
  await page.goto('/#hooks');
  await expect(trace.locator('[aria-current="step"]')).toContainText('useState');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.locator('#execution-position')).toHaveText('2 / 5 · useMemo');
  await expect(batchResult).toHaveText('상태 변경 요청 3개 · 커밋 1회');
  const taskSummary = await summary.textContent();
  await page.getByLabel('작업 검색', { exact: true }).fill('E2E');
  await expect(page.locator('.task-row')).toHaveCount(1);
  const commits = Number(
    await page.locator('#fiber-stats > div').first().locator('strong').textContent(),
  );
  await batchButton.click();
  await expect(page.locator('#batch-value')).toHaveText('6');
  await expect(page.locator('#fiber-stats > div').first().locator('strong')).toHaveText(
    String(commits + 1),
  );
  await expect(batchResult).toHaveText('상태 변경 요청 3개 · 커밋 1회');
  await expect(summary).toHaveText(taskSummary!);
  await expect(page.locator('#execution-position')).toHaveText('2 / 5 · useMemo');
  await expect(trace.locator('[aria-current="step"]')).toContainText('useMemo');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(trace.locator('[aria-current="step"]')).toContainText('Props');
  await page.reload();
  await expect(page.locator('.task-title').filter({ hasText: 'E2E task' })).toBeVisible();
});

test('responsive layout, keyboard patch and no application errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto('/#lab');
  await page.getByLabel('테스트 HTML 소스', { exact: true }).fill('<p>Keyboard patch</p>');
  await page.getByLabel('테스트 HTML 소스', { exact: true }).press('Control+Enter');
  await expect(page.locator('#actual')).toHaveText('Keyboard patch');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto('/#guide');
  await expect(page.getByRole('heading', { name: '화면 뒤에서 일어나는 일.' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('memory game preserves card DOM and records attempts, batching and the mismatch timer', async ({
  page,
}) => {
  // Keeping each shuffle swap on its current index makes the test deck repeat the same eight faces.
  await page.addInitScript(() => {
    Math.random = () => 0.9999;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '카드 테이블', level: 1 })).toBeVisible();
  await expect(page.locator('#experiment-title')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Fiber Lab 홈' })).toBeVisible();
  await expect(page.getByRole('button', { name: '상태로 바꾸기' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'HTML로 바꾸기' })).toHaveCount(0);
  const game = page.getByRole('group', { name: '4×4 게임 보드' });
  const cards = game.getByRole('button');
  const pairs = page.locator('#game-pairs');
  const attempts = page.locator('#game-attempts');
  const inspector = page.locator('#game-inspector');
  const state = page.locator('#game-inspector-state');
  const commitSummary = state.locator('.inspector-commit-summary');
  const dom = page.locator('#game-inspector-dom');
  const commits = page.getByLabel('커밋', { exact: true });
  const openInspector = page
    .locator('.site-header')
    .getByRole('button', { name: '렌더링 검사기 열기' });
  const closeInspector = page.getByRole('button', { name: '렌더링 검사기 닫기' });
  const stateTab = page.getByRole('button', { name: 'Phase 2 · State' });
  const domTab = page.getByRole('button', { name: 'Phase 1 · DOM' });
  await expect(cards).toHaveCount(16);
  await expect(page.locator('body')).toHaveClass('game-theme');
  await expect(cards.first()).toHaveCSS('background-image', /memory-card-back/);
  await expect(pairs).toHaveText('맞춘 짝 0 / 8');
  await expect(attempts).toHaveText('시도 0회');
  await expect(
    page.getByRole('complementary', { name: '모의 광고' }).getByText('모의 광고'),
  ).toHaveCount(4);
  await expect(inspector).toBeHidden();
  const firstCard = await cards.first().elementHandle();

  await cards.first().click();
  await expect(cards.first()).toHaveAccessibleName('1번 카드, A 스페이드 · 앞면');
  await expect(inspector).toBeHidden();
  await openInspector.click();
  await expect(state.locator('dd').first()).toHaveText('[] → [1]');
  await expect(state).toContainText('Card[1].appearance');
  await expect(attempts).toHaveText('시도 0회');
  await expect(commitSummary).toHaveText('상태 변경 요청 1개 · 커밋 1회');
  const firstFlipCommit = Number(await commits.inputValue());
  await domTab.click();
  await expect(state).toBeHidden();
  await expect(dom.locator('li').filter({ hasText: /TEXT.*nodeValue.*♠/ })).toHaveCount(1);

  await cards.nth(8).click();
  await expect(cards.first()).toHaveAccessibleName('1번 카드, A 스페이드 · 짝 맞춤');
  await expect(game.locator('.memory-card-matched')).toHaveCount(2);
  await expect(pairs).toHaveText('맞춘 짝 1 / 8');
  await expect(attempts).toHaveText('시도 1회');
  await expect(dom).toContainText('memory-card-matched');
  await expect(dom).toContainText('시도 1회');
  await stateTab.click();
  await expect(state.locator('dd').nth(1)).toHaveText('[] → [1, 9]');
  await expect(state.locator('dd').nth(2)).toHaveText('0 → 1');
  await expect(commits).toHaveValue(String(firstFlipCommit + 1));
  await expect(commitSummary).toHaveText('상태 변경 요청 2개 · 커밋 1회');
  expect(await firstCard!.evaluate((node) => node === document.querySelector('.memory-card'))).toBe(
    true,
  );

  await cards.nth(1).click();
  await expect(cards.nth(1)).toHaveClass(/memory-card-open/);
  await cards.nth(2).click();
  await expect(commits.locator('option').filter({ hasText: '서로 다른 카드' })).toHaveCount(1);
  await expect(game.locator('.memory-card-open')).toHaveCount(0);
  await expect(commits.locator('option:checked')).toContainText('두 카드 다시 덮기');
  await expect(state.locator('dd').first()).toHaveText('[2, 3] → []');
  await expect(attempts).toHaveText('시도 2회');
  await expect(state.locator('dd').nth(2)).toHaveText('2 → 2');
  await expect(commitSummary).toHaveText('상태 변경 요청 1개 · 커밋 1회');
  await commits.selectOption({
    label: (await commits.locator('option').filter({ hasText: '서로 다른 카드' }).textContent())!,
  });
  await expect(state).toContainText('타이머 예약 (1200ms)');
  await expect(state.locator('dd').first()).toHaveText('[2] → [2, 3]');
  await expect(state.locator('dd').nth(2)).toHaveText('1 → 2');
  await expect(commitSummary).toHaveText('상태 변경 요청 2개 · 커밋 1회');
  await commits.selectOption({ index: 0 });
  await expect(pairs).toHaveText('맞춘 짝 1 / 8');

  await closeInspector.click();
  await expect(inspector).toBeHidden();
  await page.getByRole('button', { name: '다시 시작' }).click();
  await expect(game.locator('.memory-card-down')).toHaveCount(16);
  await expect(pairs).toHaveText('맞춘 짝 0 / 8');
  await expect(attempts).toHaveText('시도 0회');
  await openInspector.click();
  await expect(commits.locator('option:checked')).toContainText('새 게임');
  await expect(state.locator('dd').nth(1)).toHaveText('[1, 9] → []');
  await expect(state.locator('dd').nth(2)).toHaveText('2 → 0');

  await cards.first().click();
  await expect(cards.first()).toHaveClass(/memory-card-open/);
  await cards.nth(8).evaluate((card) => {
    if (!(card instanceof HTMLButtonElement)) throw new Error('Expected a card button');
    card.click();
    card.click();
  });
  await expect(attempts).toHaveText('시도 1회');
  await expect(game.locator('.memory-card-matched')).toHaveCount(2);
  await expect(commitSummary).toHaveText('상태 변경 요청 2개 · 커밋 1회');
  await closeInspector.press('Escape');
  await expect(inspector).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto('/#lab');
  await expect(page.locator('#actual')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass('game-theme');
});
