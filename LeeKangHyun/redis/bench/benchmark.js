// 성능 벤치마크 CLI: npm run bench -- --spawn
// 데모 앱(GET /api/dashboard)을 HTTP로 불러 "DBMS 직접"과 "Redis 캐시"의 응답 시간을 잰다.
//   --spawn              미니 Redis와 데모 앱을 이 스크립트가 직접 (빈 포트로) 띄우고, 끝나면 종료한다
//   --demo-url <url>     --spawn이 없을 때 이미 떠 있는 데모 앱 주소 (기본 http://127.0.0.1:4000, 미니 Redis도 떠 있어야 함)
//   --requests <n>       측정할 요청 수 (기본 200)        --warmup <n>   워밍업 요청 수 (기본 20, 통계에서 제외)
//   --concurrency <a,b>  동시 요청 수 목록 (기본 1,20)    --db <파일>    DB 파일 (기본 demo/data/demo.db, 환경 정보를 읽는 데도 씀)
//   --out <폴더>         결과 저장 폴더 (기본 bench/results)   --no-save   파일로 저장하지 않음
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_DB_PATH, openDb } from "../demo/db.js";
import { summarize } from "../demo/web/stats.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULTS = { requests: 200, warmup: 20, concurrency: [1, 20], demoUrl: "http://127.0.0.1:4000", db: process.env.DEMO_DB_PATH ?? DEFAULT_DB_PATH, out: path.join(ROOT, "bench", "results"), spawn: false, save: true };
const USERNAME = "demo";
const PASSWORD = "demo1234"; // 로컬 데모용 테스트 값 (demo/seed_users.js)

export function parseArgs(argv) {
    const options = { ...DEFAULTS, concurrency: [...DEFAULTS.concurrency] };
    const positiveInt = (name, raw) => {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1) throw new Error(`${name}는 1 이상의 정수여야 합니다 (받은 값: ${raw})`);
        return value;
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            if (i + 1 >= argv.length) throw new Error(`${arg}에는 값이 필요합니다`);
            return argv[++i];
        };
        if (arg === "--spawn") options.spawn = true;
        else if (arg === "--no-save") options.save = false;
        else if (arg === "--requests") options.requests = positiveInt(arg, value());
        else if (arg === "--warmup") {
            const warmup = Number(value());
            if (!Number.isInteger(warmup) || warmup < 0) throw new Error(`--warmup은 0 이상의 정수여야 합니다 (받은 값: ${argv[i]})`);
            options.warmup = warmup;
        }
        else if (arg === "--concurrency") options.concurrency = value().split(",").map((v) => positiveInt("--concurrency", v.trim()));
        else if (arg === "--demo-url") options.demoUrl = value().replace(/\/+$/, "");
        else if (arg === "--db") options.db = value();
        else if (arg === "--out") options.out = value();
        else if (arg === "--help" || arg === "-h") options.help = true;
        else throw new Error(`알 수 없는 옵션: ${arg}`);
    }
    return options;
}

// ---------- 측정 ----------

// concurrency개의 작업자가 count개의 요청을 나눠서 처리한다. 걸린 전체 시간(wallMs)도 같이 돌려준다.
async function runPhase(count, concurrency, task) {
    const results = new Array(count);
    let next = 0;
    const started = performance.now();
    await Promise.all(
        Array.from({ length: Math.min(concurrency, count) }, async () => {
            for (let i = next++; i < count; i = next++) results[i] = await task(i);
        }),
    );
    return { results, wallMs: performance.now() - started };
}

async function login(demoUrl) {
    const res = await fetch(`${demoUrl}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: USERNAME, password: PASSWORD }) });
    if (!res.ok) throw new Error(`로그인에 실패했습니다 (HTTP ${res.status}). 데모 앱과 미니 Redis가 떠 있는지, npm run seed로 계정을 만들었는지 확인하세요.`);
    return res.headers.getSetCookie()[0].split(";")[0];
}

// 요청 하나의 걸린 시간(ms)을 잰다: 요청을 보내고 응답 본문을 다 읽을 때까지
async function timedGet(demoUrl, cookie, query) {
    const started = performance.now();
    const res = await fetch(`${demoUrl}/api/dashboard?${query}`, { headers: { Cookie: cookie } });
    const body = await res.json();
    const ms = performance.now() - started;
    if (!res.ok) throw new Error(`대시보드 요청이 실패했습니다 (HTTP ${res.status}): ${JSON.stringify(body)}`);
    return { ms, serverMs: body.elapsedMs, cache: res.headers.get("X-Cache"), source: res.headers.get("X-Source") };
}

export async function runBenchmark({ demoUrl, requests, warmup, concurrency, dbInfo = null, delayMs = null }) {
    const cookie = await login(demoUrl);
    const clearCache = async () => {
        const res = await fetch(`${demoUrl}/api/dashboard/cache`, { method: "DELETE", headers: { Cookie: cookie } });
        if (!res.ok) throw new Error(`캐시 삭제에 실패했습니다 (HTTP ${res.status})`);
    };

    const scenarios = [
        { id: "db", label: "DBMS 직접 (SQLite)", expect: "BYPASS", levels: concurrency, task: () => timedGet(demoUrl, cookie, "mode=db") },
        { id: "hit", label: "Redis 캐시 HIT", expect: "HIT", levels: concurrency, prepare: clearCache, task: () => timedGet(demoUrl, cookie, "mode=redis") },
        {
            // 요청마다 캐시를 지운 뒤 호출한다: DBMS 조회에 Redis 호출(조회와 저장)이 더해진 비용. 지우는 시간은 재지 않는다.
            // 동시에 여러 요청이 오면 다른 요청이 캐시를 채워 버려서 MISS가 보장되지 않으므로 동시성 1에서만 잰다.
            id: "miss",
            label: "Redis 캐시 MISS (DBMS + Redis)",
            expect: "MISS",
            levels: [1],
            task: async () => {
                await clearCache();
                return timedGet(demoUrl, cookie, "mode=redis");
            },
        },
    ];

    const rows = [];
    for (const scenario of scenarios) {
        for (const level of scenario.levels) {
            await scenario.prepare?.();
            await runPhase(warmup, level, scenario.task); // 워밍업: 연결과 JIT, 캐시를 데우는 용도라 통계에서 제외한다
            const { results, wallMs } = await runPhase(requests, level, scenario.task);
            const unexpected = results.filter((r) => r.cache !== scenario.expect).length;
            rows.push({
                scenario: scenario.id,
                label: scenario.label,
                concurrency: level,
                requests,
                warmup,
                client: summarize(results.map((r) => r.ms)),
                server: summarize(results.map((r) => r.serverMs)),
                // MISS는 요청마다 캐시 삭제 호출이 끼어 있어서 전체 시간으로 처리량을 구할 수 없다
                throughput: scenario.id === "miss" ? null : requests / (wallMs / 1000),
                unexpected,
            });
        }
    }

    const cpus = os.cpus();
    return {
        measuredAt: new Date().toISOString(),
        command: `node ${path.relative(ROOT, process.argv[1] ?? "bench/benchmark.js")} ${process.argv.slice(2).join(" ")}`.trim(), // 저장소 폴더 기준 상대 경로로 적는다
        options: { requests, warmup, concurrency },
        env: {
            node: process.version,
            os: `${os.type()} ${os.release()} ${os.arch()}`,
            cpu: cpus[0]?.model?.trim() ?? "알 수 없음",
            cores: cpus.length,
            dbRows: dbInfo?.rows ?? null,
            dbIndex: dbInfo?.indexed ?? null,
            delayMs,
        },
        rows,
    };
}

// ---------- 출력 ----------

const ms = (v) => (v === null ? "-" : v.toFixed(2));

export function formatMarkdown(result) {
    const { env, options } = result;
    const lines = [
        `# 벤치마크 결과 (${result.measuredAt})`,
        "",
        "## 환경",
        "",
        "| 항목 | 값 |",
        "|---|---|",
        `| 측정 일시 | ${result.measuredAt} |`,
        `| 명령 | \`${result.command}\` |`,
        `| Node | ${env.node} |`,
        `| OS | ${env.os} |`,
        `| CPU | ${env.cpu} (${env.cores}코어) |`,
        `| DB 행 수 | ${env.dbRows === null ? "확인 못 함" : env.dbRows.toLocaleString("en-US")} |`,
        `| username 인덱스 (DB_INDEX) | ${env.dbIndex ?? "확인 못 함"} |`,
        `| 인위적 지연 (DASHBOARD_DELAY_MS) | ${env.delayMs === null ? "확인 못 함 (외부에서 실행한 서버)" : `${env.delayMs}ms`} |`,
        `| 요청 수 / 워밍업 | ${options.requests} / ${options.warmup} (워밍업은 통계에서 제외) |`,
        "",
        "## 결과 (ms, 클라이언트에서 잰 HTTP 요청 왕복 시간)",
        "",
        "| 시나리오 | 동시성 | 평균 | p50 | p95 | p99 | 최소 | 최대 | 처리량 (req/s) | 서버 내부 p50 |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ];
    for (const r of result.rows) {
        const c = r.client;
        lines.push(`| ${r.label} | ${r.concurrency} | ${ms(c.mean)} | ${ms(c.p50)} | ${ms(c.p95)} | ${ms(c.p99)} | ${ms(c.min)} | ${ms(c.max)} | ${r.throughput === null ? "-" : r.throughput.toFixed(0)} | ${ms(r.server.p50)} |`);
    }
    const bad = result.rows.filter((r) => r.unexpected > 0);
    if (bad.length) lines.push("", `> 주의: 예상과 다른 응답이 있었습니다: ${bad.map((r) => `${r.label}(동시성 ${r.concurrency}) ${r.unexpected}건`).join(", ")}`);
    lines.push(
        "",
        "- 서버 내부 p50: 데모 앱이 응답 본문에 담아 준 `elapsedMs`의 중앙값 (HTTP 왕복을 뺀, 서버 안에서 조회에 쓴 시간).",
        "- 처리량은 측정 구간의 전체 시간으로 나눈 값입니다. MISS는 요청마다 캐시 삭제 호출이 끼어서 구하지 않습니다.",
        "- 인덱스 유무에 따라 결과가 크게 달라지므로 `DB_INDEX=off`와 `DB_INDEX=on`으로 각각 시드하고 두 번 재서 비교하세요.",
    );
    return `${lines.join("\n")}\n`;
}

function saveResult(result, dir) {
    mkdirSync(dir, { recursive: true });
    const stamp = result.measuredAt.replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
    const base = path.join(dir, `benchmark_${stamp}_index-${result.env.dbIndex ?? "unknown"}`);
    writeFileSync(`${base}.json`, `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(`${base}.md`, formatMarkdown(result));
    return base;
}

// ---------- 서버 띄우기 (--spawn) ----------

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

async function waitUntilReady(url, child, getOutput, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`서버가 시작하지 못하고 종료했습니다 (${url}):\n${getOutput()}`);
        try {
            if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
        } catch {
            /* 아직 준비 중 */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`서버가 ${timeoutMs}ms 안에 준비되지 않았습니다 (${url}):\n${getOutput()}`);
}

async function spawnServers(dbPath) {
    const redisPort = await freePort();
    const demoPort = await freePort();
    const redisUrl = `http://127.0.0.1:${redisPort}`;
    const demoUrl = `http://127.0.0.1:${demoPort}`;
    const children = [];
    const start = (script, env) => {
        const child = spawn(process.execPath, [script], { cwd: ROOT, env: { ...process.env, ...env, DASHBOARD_DELAY_MS: "0" }, stdio: ["ignore", "ignore", "pipe"] });
        let output = "";
        child.stderr.on("data", (d) => (output += d));
        children.push(child);
        return { child, output: () => output };
    };
    const redis = start("src/server.js", { PORT: String(redisPort) });
    const demo = start("demo/server.js", { PORT: String(demoPort), REDIS_URL: redisUrl, DEMO_DB_PATH: dbPath });
    const stop = async () => {
        await Promise.all(
            children.map(
                (c) =>
                    new Promise((resolve) => {
                        if (c.exitCode !== null) return resolve();
                        c.once("exit", resolve);
                        c.kill();
                    }),
            ),
        );
    };
    try {
        await waitUntilReady(`${redisUrl}/health`, redis.child, redis.output);
        await waitUntilReady(`${demoUrl}/`, demo.child, demo.output);
    } catch (err) {
        await stop();
        throw err;
    }
    return { demoUrl, stop };
}

// ---------- 실행 ----------

const USAGE = "사용법: npm run bench -- --spawn [--requests 200] [--warmup 20] [--concurrency 1,20] [--db <파일>] [--out <폴더>] [--no-save]";

async function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(`${err.message}\n${USAGE}`);
        process.exit(1);
    }
    if (options.help) return console.log(USAGE);

    let dbInfo = null;
    try {
        const db = openDb(options.db);
        dbInfo = db.info();
        db.close();
    } catch (err) {
        console.error(`${err.message}`);
        if (options.spawn) process.exit(1); // 직접 띄울 때는 DB가 없으면 데모 앱도 못 뜬다
    }

    let stack = null;
    try {
        stack = options.spawn ? await spawnServers(options.db) : null;
        const result = await runBenchmark({ demoUrl: stack?.demoUrl ?? options.demoUrl, requests: options.requests, warmup: options.warmup, concurrency: options.concurrency, dbInfo, delayMs: stack ? 0 : null });
        console.log(formatMarkdown(result));
        if (options.save) console.log(`결과를 저장했습니다: ${saveResult(result, options.out)}.{json,md}`);
    } catch (err) {
        console.error(err.message);
        process.exitCode = 1;
    } finally {
        await stack?.stop();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
