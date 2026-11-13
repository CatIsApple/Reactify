// 파일 이름을 *_test.js로 한 이유: node --test는 찾지만, 루트의 Vitest 기본 패턴(*.test.js)에는 잡히지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { percentile, summarize } from "../demo/web/stats.js";

const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);

test("percentile: nearest-rank 방식 (1..100이면 p50=50, p95=95, p99=99, p100=100)", () => {
    assert.equal(percentile(oneToHundred, 50), 50);
    assert.equal(percentile(oneToHundred, 95), 95);
    assert.equal(percentile(oneToHundred, 99), 99);
    assert.equal(percentile(oneToHundred, 100), 100);
    assert.equal(percentile(oneToHundred, 0), 1); // 0%는 가장 작은 값
    assert.equal(percentile(oneToHundred, 1), 1);
});

test("percentile: 작은 표본은 올림한 순번의 값", () => {
    assert.equal(percentile([10, 20, 30, 40], 50), 20); // ceil(0.5 * 4) = 2번째
    assert.equal(percentile([10, 20, 30, 40], 95), 40);
    assert.equal(percentile([10, 20, 30, 40], 25), 10);
    assert.equal(percentile([10, 20, 30, 40], 75), 30);
    assert.equal(percentile([7], 50), 7);
    assert.equal(percentile([7], 99), 7);
});

test("percentile: 정렬되지 않은 입력도 처리하고, 입력 배열을 바꾸지 않는다", () => {
    const input = [5, 1, 4, 2, 3];
    assert.equal(percentile(input, 50), 3);
    assert.equal(percentile(input, 100), 5);
    assert.deepEqual(input, [5, 1, 4, 2, 3]);
});

test("percentile: 빈 배열은 null", () => {
    assert.equal(percentile([], 50), null);
    assert.equal(percentile([], 99), null);
});

test("summarize: 알려진 배열의 평균, 중앙값, p95, p99, 최소, 최대", () => {
    const s = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(s, { count: 10, mean: 5.5, min: 1, max: 10, p50: 5, p95: 10, p99: 10 });

    const wide = summarize(oneToHundred);
    assert.equal(wide.count, 100);
    assert.equal(wide.mean, 50.5);
    assert.equal(wide.p50, 50);
    assert.equal(wide.p95, 95);
    assert.equal(wide.p99, 99);
    assert.equal(wide.min, 1);
    assert.equal(wide.max, 100);
});

test("summarize: 소수와 한 개짜리 표본", () => {
    const s = summarize([0.4, 0.5, 0.6]);
    assert.ok(Math.abs(s.mean - 0.5) < 1e-12);
    assert.equal(s.p50, 0.5);
    assert.deepEqual(summarize([3.25]), { count: 1, mean: 3.25, min: 3.25, max: 3.25, p50: 3.25, p95: 3.25, p99: 3.25 });
});

test("summarize: 빈 배열은 개수 0과 null들 (NaN이나 예외가 아니다)", () => {
    assert.deepEqual(summarize([]), { count: 0, mean: null, min: null, max: null, p50: null, p95: null, p99: null });
});

test("summarize: 아주 큰 표본(20만 개)에도 스택이 넘치지 않는다", () => {
    const big = Array.from({ length: 200_000 }, (_, i) => i);
    const s = summarize(big);
    assert.equal(s.count, 200_000);
    assert.equal(s.min, 0);
    assert.equal(s.max, 199_999);
    assert.equal(s.p50, 99_999);
});

test("summarize: 입력 배열을 바꾸지 않는다", () => {
    const input = [3, 1, 2];
    summarize(input);
    assert.deepEqual(input, [3, 1, 2]);
});
