// 파일 이름을 *_test.js로 한 이유: node --test는 찾지만, 루트의 Vitest 기본 패턴(*.test.js)에는 잡히지 않는다.
// 서버를 실제 프로세스로 실행해서 시작할 때의 동작(포트 충돌 안내, 기본값, 시작 점검)을 검증한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createApp, shutdown } from "../src/server.js";
import { Store } from "../src/store.js";
import { checkMiniRedis } from "../demo/server.js";
import { seedDb } from "../demo/seed_db.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const listen = (server, port = 0) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
});
const close = (server) => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
});

// 자식 프로세스로 실행하고 종료까지 기다린다. waitFor가 있으면 그 문구가 출력되는 순간 프로세스를 끝낸다.
function run(script, env, { waitFor, timeoutMs = 15_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script], { cwd: ROOT, env: { ...process.env, ...env } });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`시간 초과\nstdout: ${stdout}\nstderr: ${stderr}`));
        }, timeoutMs);
        const finish = (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        };
        child.stdout.on("data", (d) => {
            stdout += d;
            if (waitFor && waitFor.test(stdout) && !child.killed) {
                // 경고가 뒤따를 시간을 잠깐 준 뒤 끝낸다
                setTimeout(() => child.kill(), 800);
            }
        });
        child.stderr.on("data", (d) => (stderr += d));
        child.on("exit", (code) => finish(code));
        child.on("error", reject);
    });
}

// 데모 앱은 시작할 때 DB부터 열기 때문에, 데모를 실제로 띄우는 테스트는 임시 시드 DB를 쓴다 (끝나면 지운다)
async function withSeededDb(runWith) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mini-redis-startup-"));
    try {
        const file = path.join(dir, "demo.db");
        seedDb({ file, rows: 10 });
        return await runWith(file);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

const occupy = async () => {
    const blocker = http.createServer((req, res) => res.end("busy"));
    await listen(blocker);
    return blocker;
};

// ---------- 포트 충돌 ----------

test("미니 Redis: 포트가 이미 사용 중이면 스택 트레이스 없이 안내 메시지를 내고 종료 코드 1", async () => {
    const blocker = await occupy();
    try {
        const port = blocker.address().port;
        const { code, stdout, stderr } = await run("src/server.js", { PORT: String(port) });
        assert.equal(code, 1);
        assert.ok(stderr.includes(`포트 ${port}이 이미 사용 중입니다. PORT 환경변수로 다른 포트를 지정하세요`), stderr);
        assert.ok(!/\n\s+at /.test(stderr), `스택 트레이스가 없어야 한다:\n${stderr}`);
        assert.ok(!stdout.includes("listening"));
    } finally {
        await close(blocker);
    }
});

test("데모 앱: 포트가 이미 사용 중이면 같은 안내와 종료 코드 1", async () => {
    const blocker = await occupy();
    try {
        const port = blocker.address().port;
        const { code, stderr } = await withSeededDb((file) => run("demo/server.js", { PORT: String(port), DEMO_DB_PATH: file }));
        assert.equal(code, 1);
        assert.ok(stderr.includes(`포트 ${port}이 이미 사용 중입니다. PORT 환경변수로 다른 포트를 지정하세요`), stderr);
        assert.ok(!/\n\s+at /.test(stderr), `스택 트레이스가 없어야 한다:\n${stderr}`);
    } finally {
        await close(blocker);
    }
});

test("미니 Redis의 기본 포트는 6380이다 (PORT를 주지 않고 6380을 막아 두면 6380 충돌 안내가 나온다)", async () => {
    const blocker = http.createServer();
    try {
        await listen(blocker, 6380);
    } catch (err) {
        if (err.code !== "EADDRINUSE") throw err; // 이미 다른 프로그램이 6380을 쓰고 있어도 같은 상황이다
    }
    try {
        const { code, stderr } = await new Promise((resolve, reject) => {
            const env = { ...process.env };
            delete env.PORT; // PORT 환경변수가 없을 때의 기본값을 본다
            const child = spawn(process.execPath, ["src/server.js"], { cwd: ROOT, env });
            let err = "";
            child.stderr.on("data", (d) => (err += d));
            child.on("exit", (c) => resolve({ code: c, stderr: err }));
            child.on("error", reject);
            setTimeout(() => child.kill(), 10_000).unref();
        });
        assert.equal(code, 1);
        assert.ok(stderr.includes("포트 6380이 이미 사용 중입니다"), stderr);
    } finally {
        if (blocker.listening) await close(blocker);
    }
});

// ---------- 데모 앱 시작 점검 ----------

test("데모 앱의 REDIS_URL 기본값은 http://127.0.0.1:6380이고, 미니 Redis가 없으면 경고를 내고도 서버는 켜진다", async () => {
    const env = { ...process.env, PORT: "0" };
    delete env.REDIS_URL;
    const { stdout, stderr } = await withSeededDb((file) => run("demo/server.js", { ...env, DEMO_DB_PATH: file }, { waitFor: /listening/ }));
    assert.ok(stdout.includes("mini redis: http://127.0.0.1:6380"), stdout);
    // 6380에서 실제 미니 Redis가 돌고 있지 않을 때만 경고가 나온다
    if (stderr) assert.match(stderr, /경고: /);
});

test("checkMiniRedis: 미니 Redis가 응답하면 ok", async () => {
    const store = new Store();
    const server = createApp(store);
    await listen(server);
    try {
        const result = await checkMiniRedis(`http://127.0.0.1:${server.address().port}`);
        assert.deepEqual(result, { ok: true, message: "" });
        assert.equal((await checkMiniRedis(`http://127.0.0.1:${server.address().port}/`)).ok, true); // 끝의 /는 무시
    } finally {
        await shutdown(server, store);
    }
});

test("checkMiniRedis: 다른 프로그램이 응답하면 '미니 Redis가 아닌 서버' 경고 (Live Preview의 404 HTML과 426 포함)", async () => {
    const impostors = [
        (req, res) => { res.writeHead(404, { "Content-Type": "text/html" }); res.end("<html>Cannot GET /health</html>"); },
        (req, res) => { res.writeHead(426, { "Content-Type": "text/plain" }); res.end("Upgrade Required"); },
        (req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"status":"starting"}'); }, // 200이지만 ok가 아님
        (req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end("[]"); },
        (req, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok"); },
    ];
    for (const handler of impostors) {
        const server = http.createServer(handler);
        await listen(server);
        try {
            const result = await checkMiniRedis(`http://127.0.0.1:${server.address().port}`);
            assert.equal(result.ok, false);
            assert.match(result.message, /미니 Redis가 아닌 서버가 응답하고 있습니다/);
            assert.match(result.message, /주소\/포트를 확인/);
        } finally {
            await close(server);
        }
    }
});

test("checkMiniRedis: 연결할 수 없거나 응답이 없으면 각각 안내 메시지", async () => {
    const probe = http.createServer();
    await listen(probe);
    const { port } = probe.address();
    await close(probe);
    const closed = await checkMiniRedis(`http://127.0.0.1:${port}`);
    assert.equal(closed.ok, false);
    assert.match(closed.message, /연결할 수 없습니다/);
    assert.match(closed.message, /npm start/);

    const hanging = http.createServer(() => {});
    await listen(hanging);
    try {
        const slow = await checkMiniRedis(`http://127.0.0.1:${hanging.address().port}`, 50);
        assert.equal(slow.ok, false);
        assert.match(slow.message, /응답이 없습니다/);
    } finally {
        await close(hanging);
    }
});
