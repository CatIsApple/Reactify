// 파일 이름을 *_test.js로 한 이유: node --test는 찾지만, 루트의 Vitest 기본 패턴(*.test.js)에는 잡히지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatMarkdown, parseArgs } from "../bench/benchmark.js";
import { seedDb } from "../demo/seed_db.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withTempDir(run) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mini-redis-bench-"));
    try {
        await run(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

function runCli(args, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["bench/benchmark.js", ...args], { cwd: ROOT, env: { ...process.env, ...env } });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`시간 초과\n${stdout}\n${stderr}`));
        }, 90_000);
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.on("exit", (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        });
    });
}

test("parseArgs: 기본값", () => {
    const o = parseArgs([]);
    assert.equal(o.requests, 200);
    assert.equal(o.warmup, 20);
    assert.deepEqual(o.concurrency, [1, 20]);
    assert.equal(o.spawn, false);
    assert.equal(o.save, true);
    assert.equal(o.demoUrl, "http://127.0.0.1:4000");
});

test("parseArgs: 옵션을 읽는다", () => {
    const o = parseArgs(["--spawn", "--requests", "50", "--warmup", "0", "--concurrency", "1, 5,20", "--demo-url", "http://localhost:5000/", "--db", "x.db", "--out", "out", "--no-save"]);
    assert.equal(o.spawn, true);
    assert.equal(o.requests, 50);
    assert.equal(o.warmup, 0); // 워밍업 0은 허용
    assert.deepEqual(o.concurrency, [1, 5, 20]);
    assert.equal(o.demoUrl, "http://localhost:5000"); // 끝의 /는 없앤다
    assert.equal(o.db, "x.db");
    assert.equal(o.out, "out");
    assert.equal(o.save, false);
});

test("parseArgs: 잘못된 옵션은 에러", () => {
    for (const argv of [["--requests", "0"], ["--requests", "abc"], ["--requests", "1.5"], ["--warmup", "-1"], ["--concurrency", "1,0"], ["--concurrency", "x"], ["--requests"], ["--unknown"]]) {
        assert.throws(() => parseArgs(argv), Error, argv.join(" "));
    }
});

test("formatMarkdown: 환경 정보와 결과 표, 예상과 다른 응답 경고", () => {
    const stat = (v) => ({ count: 10, mean: v, min: v, max: v, p50: v, p95: v, p99: v });
    const result = {
        measuredAt: "2026-11-13T01:00:00.000Z",
        command: "node bench/benchmark.js --spawn",
        options: { requests: 10, warmup: 2, concurrency: [1] },
        env: { node: "v26.13.0", os: "Test OS", cpu: "Test CPU", cores: 4, dbRows: 300000, dbIndex: "off", delayMs: 0 },
        rows: [
            { scenario: "db", label: "DBMS 직접 (SQLite)", concurrency: 1, requests: 10, warmup: 2, client: stat(12.345), server: stat(10), throughput: 80.5, unexpected: 0 },
            { scenario: "miss", label: "Redis 캐시 MISS (DBMS + Redis)", concurrency: 1, requests: 10, warmup: 2, client: stat(13), server: stat(11), throughput: null, unexpected: 3 },
        ],
    };
    const md = formatMarkdown(result);
    assert.match(md, /# 벤치마크 결과 \(2026-11-13T01:00:00\.000Z\)/);
    assert.match(md, /\| Node \| v26\.13\.0 \|/);
    assert.match(md, /\| CPU \| Test CPU \(4코어\) \|/);
    assert.match(md, /\| DB 행 수 \| 300,000 \|/);
    assert.match(md, /\| username 인덱스 \(DB_INDEX\) \| off \|/);
    assert.match(md, /\| DBMS 직접 \(SQLite\) \| 1 \| 12\.35 \|/); // 소수 둘째 자리
    assert.match(md, /\| Redis 캐시 MISS \(DBMS \+ Redis\) \| 1 \| 13\.00 \|.*\| - \| 11\.00 \|/); // MISS의 처리량은 "-"
    assert.match(md, /예상과 다른 응답.*MISS.*3건/);
    assert.match(md, /DB_INDEX=off.*DB_INDEX=on/s);
});

test("CLI --spawn 스모크 테스트: 서버를 직접 띄워 시나리오를 재고 결과를 JSON과 Markdown으로 저장한다", () =>
    withTempDir(async (dir) => {
        const dbFile = path.join(dir, "bench.db");
        seedDb({ file: dbFile, rows: 1000 });
        const out = path.join(dir, "results");
        const res = await runCli(["--spawn", "--db", dbFile, "--requests", "12", "--warmup", "3", "--concurrency", "1,3", "--out", out]);
        assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);

        for (const text of ["DBMS 직접 (SQLite)", "Redis 캐시 HIT", "Redis 캐시 MISS", "| 시나리오 | 동시성 |", "p95", "p99", "처리량"]) assert.ok(res.stdout.includes(text), `출력에 "${text}"가 있어야 한다`);
        assert.ok(!res.stdout.includes("예상과 다른 응답"), res.stdout);

        const files = readdirSync(out);
        const jsonName = files.find((f) => f.endsWith(".json"));
        const mdName = files.find((f) => f.endsWith(".md"));
        assert.ok(jsonName && mdName, files.join(","));
        assert.match(jsonName, /^benchmark_\d{4}-\d{2}-\d{2}_.*_index-off\.json$/); // 날짜와 인덱스 상태가 파일 이름에 들어간다

        const result = JSON.parse(readFileSync(path.join(out, jsonName), "utf8"));
        assert.equal(result.env.dbRows, 1000);
        assert.equal(result.env.dbIndex, "off");
        assert.equal(result.env.delayMs, 0);
        assert.equal(result.env.node, process.version);
        assert.ok(result.env.cores >= 1 && result.env.cpu.length > 0);
        assert.deepEqual(result.options, { requests: 12, warmup: 3, concurrency: [1, 3] });
        // 시나리오: db(동시성 1, 3), hit(1, 3), miss(1)
        assert.deepEqual(result.rows.map((r) => `${r.scenario}@${r.concurrency}`), ["db@1", "db@3", "hit@1", "hit@3", "miss@1"]);
        for (const row of result.rows) {
            assert.equal(row.client.count, 12, "워밍업 요청은 통계에서 제외된다");
            assert.equal(row.unexpected, 0, `${row.scenario}: X-Cache 헤더가 시나리오와 맞아야 한다`);
            assert.ok(row.client.min > 0 && row.client.p50 >= row.client.min && row.client.p95 >= row.client.p50 && row.client.max >= row.client.p99);
            assert.ok(row.server.count === 12 && row.server.p50 >= 0);
            if (row.scenario === "miss") assert.equal(row.throughput, null);
            else assert.ok(row.throughput > 0);
        }
        assert.equal(readFileSync(path.join(out, mdName), "utf8"), formatMarkdown(result)); // MD는 JSON과 같은 내용
    }));

test("CLI --no-save: 파일을 만들지 않는다", () =>
    withTempDir(async (dir) => {
        const dbFile = path.join(dir, "bench.db");
        seedDb({ file: dbFile, rows: 200 });
        const out = path.join(dir, "results");
        const res = await runCli(["--spawn", "--db", dbFile, "--requests", "4", "--warmup", "1", "--concurrency", "1", "--out", out, "--no-save"]);
        assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
        assert.equal(existsSync(out), false);
        assert.ok(res.stdout.includes("| DBMS 직접 (SQLite) | 1 |"));
    }));

test("CLI: DB가 없으면 안내와 함께 종료 코드 1, 잘못된 옵션도 종료 코드 1", () =>
    withTempDir(async (dir) => {
        const noDb = await runCli(["--spawn", "--db", path.join(dir, "missing.db"), "--requests", "2", "--warmup", "0", "--no-save"]);
        assert.equal(noDb.code, 1);
        assert.match(noDb.stderr, /npm run seed:db/);

        const bad = await runCli(["--requests", "abc"]);
        assert.equal(bad.code, 1);
        assert.match(bad.stderr, /--requests/);
        assert.match(bad.stderr, /사용법/);
    }));
