// 지연 시간(ms) 표본의 통계. DOM에 의존하지 않아서 브라우저 화면(/web/stats.js)과 CLI 벤치마크가 같이 쓰고 단위 테스트도 한다.

// nearest-rank 백분위수: 정렬한 표본에서 ceil(p/100 * n)번째 값. 표본이 없으면 null.
export function percentile(samples, p) {
    if (samples.length === 0) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
    return sorted[rank - 1];
}

export function summarize(samples) {
    if (samples.length === 0) return { count: 0, mean: null, min: null, max: null, p50: null, p95: null, p99: null };
    return {
        count: samples.length,
        mean: samples.reduce((sum, v) => sum + v, 0) / samples.length,
        min: samples.reduce((a, b) => (b < a ? b : a)),
        max: samples.reduce((a, b) => (b > a ? b : a)),
        p50: percentile(samples, 50),
        p95: percentile(samples, 95),
        p99: percentile(samples, 99),
    };
}
