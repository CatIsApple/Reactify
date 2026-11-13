// 파일 이름을 *_test.js로 한 이유: node --test는 찾지만, 루트의 Vitest 기본 패턴(*.test.js)에는 잡히지 않는다.
// 실제 미니 Redis 서버(포트 0)와 데모 앱 서버(포트 0)를 띄워서 fetch로 검증한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createApp, shutdown } from "../src/server.js";
import { Store } from "../src/store.js";
import { MiniRedisClient } from "../src/client.js";
import { createDemoApp } from "../demo/server.js";
import { DUMMY_CREDENTIAL, SESSION_ID_PATTERN, hashPassword, loadUsers, newSessionId, parseCookies, verifyPassword } from "../demo/auth.js";
import { seedUsers } from "../demo/seed_users.js";

const DEMO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../demo");
const SESSION_TTL = 30 * 60 * 1000;
const USERS = new Map([
    ["demo", await hashPassword("demo1234")],
    ["alice", await hashPassword("alice1234")],
]);

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

// 대시보드 원본 데이터 출처를 흉내 내는 가짜 DB: 호출 기록(calls)으로 "DB를 실제로 읽었는지"를 검증한다. (진짜 SQLite는 tests/db_test.js)
function makeStubDb() {
    const calls = [];
    return {
        calls,
        getDashboardStats(username) {
            calls.push(username);
            return { username, totalEvents: 3, totalAmount: 30, byType: [{ type: "view", count: 3, total: 30 }] };
        },
    };
}

// 미니 Redis + 데모 앱을 함께 띄운다. 저장소 시계를 주입해 세션·캐시·잠금의 만료를 시간 이동으로 검증한다.
async function startStack({ appOptions = {}, wrapClient = (c) => c } = {}) {
    const clock = { now: 1_000_000 };
    const store = new Store({ now: () => clock.now });
    const redisServer = createApp(store);
    await listen(redisServer);
    const redisClient = new MiniRedisClient({ baseUrl: `http://127.0.0.1:${redisServer.address().port}`, timeoutMs: 1000 });
    const db = appOptions.db ?? makeStubDb();
    const demoServer = createDemoApp({ redisClient: wrapClient(redisClient), users: USERS, db, dashboardDelayMs: 60, dashboardCacheTtlMs: 5000, ...appOptions });
    await listen(demoServer);
    let redisStopped = false;
    return {
        db,
        store,
        clock,
        base: `http://127.0.0.1:${demoServer.address().port}`,
        stopRedis: async () => {
            redisStopped = true;
            await shutdown(redisServer, store);
        },
        close: async () => {
            await shutdown(demoServer, { stopSweeper() {} });
            if (!redisStopped) await shutdown(redisServer, store);
        },
    };
}

async function withStack(run, options) {
    const stack = await startStack(options);
    try {
        await run(stack);
    } finally {
        await stack.close();
    }
}

async function request(base, method, urlPath, { body, cookie, headers = {} } = {}) {
    const res = await fetch(base + urlPath, {
        method,
        headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        /* JSON이 아닌 응답 (정적 파일 등) */
    }
    return { status: res.status, headers: res.headers, text, json, setCookie: res.headers.getSetCookie() };
}

const login = (base, username = "demo", password = "demo1234") => request(base, "POST", "/api/login", { body: { username, password } });
const sidCookie = (res) => res.setCookie[0].split(";")[0]; // "sid=<값>"
const sidOf = (res) => sidCookie(res).slice("sid=".length);

// fetch는 ".."를 미리 정규화하므로, 경로를 그대로 보내려면 원시 http 요청을 쓴다
function rawGet(base, rawPath, method = "GET") {
    return new Promise((resolve, reject) => {
        const req = http.request(base, { method, path: rawPath }, (res) => {
            let text = "";
            res.on("data", (chunk) => (text += chunk));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
        });
        req.on("error", reject);
        req.end();
    });
}

// ---------- 로그인과 쿠키 ----------

test("로그인 성공: 쿠키 속성(HttpOnly, SameSite, Path, Max-Age)과 Redis의 세션", () =>
    withStack(async ({ base, store }) => {
        const res = await login(base);
        assert.equal(res.status, 200);
        assert.deepEqual(res.json, { username: "demo" });
        assert.equal(res.setCookie.length, 1);
        const [pair, ...attrs] = res.setCookie[0].split("; ");
        assert.match(pair, /^sid=[0-9a-f]{64}$/);
        assert.deepEqual(attrs, ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${SESSION_TTL / 1000}`]);
        const sid = sidOf(res);
        const session = store.get(`session:${sid}`);
        assert.equal(session.username, "demo");
        assert.equal(typeof session.createdAt, "number");
        assert.equal(store.ttl(`session:${sid}`), SESSION_TTL);
    }));

test("서로 다른 로그인은 서로 다른 세션 id를 받는다", () =>
    withStack(async ({ base }) => {
        const ids = new Set();
        for (let i = 0; i < 5; i++) ids.add(sidOf(await login(base)));
        ids.add(sidOf(await login(base, "alice", "alice1234")));
        assert.equal(ids.size, 6);
        for (const id of ids) assert.match(id, SESSION_ID_PATTERN);
    }));

test("로그인 입력 검증: 누락·문자열이 아닌 값·잘못된 JSON은 400", () =>
    withStack(async ({ base }) => {
        for (const body of [{}, { username: "demo" }, { password: "x" }, { username: 1, password: "x" }, { username: "demo", password: ["x"] }, { username: "", password: "x" }, { username: "a".repeat(129), password: "x" }, "{bad", "[]"]) {
            const res = await request(base, "POST", "/api/login", { body });
            assert.equal(res.status, 400, JSON.stringify(body));
            assert.equal(res.setCookie.length, 0);
        }
    }));

test("본문이 제한을 넘으면 413", () =>
    withStack(
        async ({ base }) => {
            const res = await request(base, "POST", "/api/login", { body: { username: "demo", password: "x".repeat(300) } });
            assert.equal(res.status, 413);
        },
        { appOptions: { maxBodyBytes: 128 } },
    ));

// ---------- /me ----------

test("/me: 올바른 세션은 200, 쿠키가 없으면 401", () =>
    withStack(async ({ base }) => {
        const cookie = sidCookie(await login(base));
        const ok = await request(base, "GET", "/api/me", { cookie });
        assert.equal(ok.status, 200);
        assert.deepEqual(ok.json, { username: "demo", expiresInMs: SESSION_TTL });
        assert.equal((await request(base, "GET", "/api/me")).status, 401);
    }));

test("/me: 형식이 이상한 쿠키는 저장소를 조회하지 않고 401, 형식이 맞는 위조 sid는 조회 후 401", () => {
    const calls = [];
    // 미니 Redis로 가는 호출을 기록하는 감시자
    const spy = (client) =>
        new Proxy(client, {
            get(target, prop) {
                const value = target[prop];
                return typeof value === "function" ? (...args) => (calls.push(prop), value.apply(target, args)) : value;
            },
        });
    return withStack(
        async ({ base }) => {
            const weird = ["sid=abc", "sid=", `sid=${"g".repeat(64)}`, `sid=${"a".repeat(63)}`, `sid=${"a".repeat(65)}`, `sid=${"A".repeat(64)}`, "sid=../../etc/passwd", "sid=%E0%A4%A", "garbage", ";;;===", "__proto__=x; sid", `other=${"a".repeat(64)}`];
            for (const cookie of weird) {
                const res = await request(base, "GET", "/api/me", { cookie });
                assert.equal(res.status, 401, cookie);
            }
            assert.deepEqual(calls, [], "이상한 sid로는 Redis를 조회하지 않는다");

            const forged = await request(base, "GET", "/api/me", { cookie: `sid=${"a".repeat(64)}` });
            assert.equal(forged.status, 401);
            assert.deepEqual(calls, ["get"], "형식이 맞으면 조회하고, 없으면 401");
        },
        { wrapClient: spy },
    );
});

test("/me: sliding expiration으로 호출할 때마다 세션 TTL과 쿠키 Max-Age가 다시 늘어난다", () =>
    withStack(async ({ base, store, clock }) => {
        const first = await login(base);
        const cookie = sidCookie(first);
        const key = `session:${sidOf(first)}`;
        clock.now += 10 * 60 * 1000;
        assert.equal(store.ttl(key), 20 * 60 * 1000); // 10분 지나 20분 남았다
        const me = await request(base, "GET", "/api/me", { cookie });
        assert.equal(me.status, 200);
        assert.equal(store.ttl(key), SESSION_TTL); // 다시 30분
        assert.match(me.setCookie[0], /Max-Age=1800/);
    }));

test("세션 만료: 시간이 지나면 /me는 401이고 Redis에서도 사라진다", () =>
    withStack(async ({ base, store, clock }) => {
        const first = await login(base);
        const cookie = sidCookie(first);
        clock.now += SESSION_TTL - 1;
        assert.equal((await request(base, "GET", "/api/me", { cookie })).status, 200); // 아직 유효 (그리고 연장됨)
        clock.now += SESSION_TTL;
        assert.equal((await request(base, "GET", "/api/me", { cookie })).status, 401);
        assert.equal(store.exists(`session:${sidOf(first)}`), false);
    }));

// ---------- 로그아웃 ----------

test("로그아웃: 이후 /me는 401, 쿠키 제거(Max-Age=0), 두 번 해도 200, 쿠키 없이도 200", () =>
    withStack(async ({ base, store }) => {
        const first = await login(base);
        const cookie = sidCookie(first);
        const out = await request(base, "POST", "/api/logout", { cookie, body: {} });
        assert.equal(out.status, 200);
        assert.match(out.setCookie[0], /^sid=;/);
        assert.match(out.setCookie[0], /Max-Age=0/);
        assert.equal(store.exists(`session:${sidOf(first)}`), false);
        assert.equal((await request(base, "GET", "/api/me", { cookie })).status, 401);
        assert.equal((await request(base, "POST", "/api/logout", { cookie, body: {} })).status, 200);
        assert.equal((await request(base, "POST", "/api/logout", { body: {} })).status, 200);
    }));

// ---------- 인증 실패와 로그인 제한 ----------

test("틀린 비밀번호와 없는 아이디는 같은 401 응답", () =>
    withStack(async ({ base, store }) => {
        const wrongPassword = await login(base, "demo", "nope");
        const unknownUser = await login(base, "ghost", "nope");
        for (const res of [wrongPassword, unknownUser]) {
            assert.equal(res.status, 401);
            assert.deepEqual(res.json, { error: "invalid credentials" });
            assert.equal(res.setCookie.length, 0);
        }
        assert.equal(wrongPassword.text, unknownUser.text);
        assert.equal(wrongPassword.headers.get("content-type"), unknownUser.headers.get("content-type"));
        assert.equal(store.get("login_fail:ghost"), 1); // 없는 아이디도 같은 규칙으로 센다
    }));

test("없는 아이디에도 해시 계산을 한다 (가짜 계정 검증은 항상 실패)", async () => {
    assert.equal(await verifyPassword("anything", DUMMY_CREDENTIAL), false);
    assert.equal(await verifyPassword("", DUMMY_CREDENTIAL), false);
});

test("5회 실패하면 429와 Retry-After, 잠금 중에는 올바른 비밀번호도 거절, 시간이 지나면 풀린다", () =>
    withStack(async ({ base, store, clock }) => {
        for (let i = 1; i <= 5; i++) assert.equal((await login(base, "demo", "wrong")).status, 401, `${i}번째 실패`);
        assert.equal(store.get("login_fail:demo"), 5);
        assert.equal(store.ttl("login_fail:demo"), 5 * 60 * 1000);

        const locked = await login(base, "demo", "demo1234"); // 올바른 비밀번호
        assert.equal(locked.status, 429);
        assert.equal(locked.setCookie.length, 0);
        const retryAfter = Number(locked.headers.get("retry-after"));
        assert.ok(retryAfter > 0 && retryAfter <= 300, `Retry-After=${retryAfter}`);

        assert.equal((await login(base, "alice", "alice1234")).status, 200); // 다른 계정은 영향이 없다

        clock.now += 5 * 60 * 1000; // 잠금 시간이 지나 카운터가 만료된다
        assert.equal((await login(base, "demo", "demo1234")).status, 200);
    }));

test("성공한 로그인은 실패 카운터를 초기화한다", () =>
    withStack(async ({ base, store }) => {
        for (let i = 0; i < 3; i++) await login(base, "demo", "wrong");
        assert.equal(store.get("login_fail:demo"), 3);
        assert.equal((await login(base, "demo", "demo1234")).status, 200);
        assert.equal(store.get("login_fail:demo"), undefined);
        for (let i = 0; i < 4; i++) assert.equal((await login(base, "demo", "wrong")).status, 401); // 다시 처음부터 센다
        assert.equal((await login(base, "demo", "demo1234")).status, 200);
    }));

test("만료 시간이 없는 실패 카운터가 남아 있어도 다시 만료를 걸어 영구 잠금을 막는다", () =>
    withStack(async ({ base, store, clock }) => {
        store.set("login_fail:demo", 2); // incr 직후 expire 전에 멈춘 상황을 흉내 (TTL 없음)
        assert.equal((await login(base, "demo", "wrong")).status, 401);
        assert.equal(store.ttl("login_fail:demo"), 5 * 60 * 1000);
        clock.now += 5 * 60 * 1000;
        assert.equal(store.get("login_fail:demo"), undefined);
    }));

// ---------- CSRF 방어 ----------

test("Content-Type이 application/json이 아닌 POST는 415", () =>
    withStack(async ({ base }) => {
        const cookie = sidCookie(await login(base));
        const body = JSON.stringify({ username: "demo", password: "demo1234" });
        for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", undefined]) {
            const res = await fetch(`${base}/api/login`, { method: "POST", headers: type ? { "Content-Type": type } : {}, body: type === "application/x-www-form-urlencoded" ? "username=demo&password=demo1234" : body });
            assert.equal(res.status, 415, String(type));
            assert.equal(res.headers.getSetCookie().length, 0);
        }
        const logout = await fetch(`${base}/api/logout`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "text/plain" }, body: "{}" });
        assert.equal(logout.status, 415);
        assert.equal((await request(base, "GET", "/api/me", { cookie })).status, 200); // 로그아웃되지 않았다
        // charset 같은 매개변수가 붙은 json은 허용
        const ok = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body });
        assert.equal(ok.status, 200);
    }));

test("메서드·경로 오류: 405(Allow), 404, 응답은 모두 JSON", () =>
    withStack(async ({ base }) => {
        let res = await request(base, "GET", "/api/login");
        assert.equal(res.status, 405);
        assert.equal(res.headers.get("allow"), "POST");
        assert.equal((await request(base, "POST", "/api/me", { body: {} })).status, 405);
        assert.equal((await request(base, "PUT", "/api/dashboard", { body: {} })).status, 405);
        res = await request(base, "GET", "/api/nothing");
        assert.equal(res.status, 404);
        assert.equal(res.headers.get("content-type"), "application/json");
        assert.ok(res.json.error);
        assert.equal((await request(base, "GET", "/api/constructor")).status, 404);
    }));

// ---------- 대시보드 캐시 ----------

test("대시보드는 로그인이 필요하다", () =>
    withStack(async ({ base }) => {
        assert.equal((await request(base, "GET", "/api/dashboard")).status, 401);
        assert.equal((await request(base, "DELETE", "/api/dashboard/cache")).status, 401);
    }));

test("대시보드 캐시(mode=redis, 기본): MISS → HIT(DB를 읽지 않고 더 빠름) → 삭제 후 MISS → TTL 후 MISS", () =>
    withStack(async ({ base, store, clock, db }) => {
        const cookie = sidCookie(await login(base));
        const get = (suffix = "") => request(base, "GET", `/api/dashboard${suffix}`, { cookie });

        const miss = await get(); // mode를 주지 않으면 redis 모드
        assert.equal(miss.status, 200);
        assert.equal(miss.headers.get("x-cache"), "MISS");
        assert.equal(miss.headers.get("x-source"), "db");
        assert.equal(miss.json.source, "db");
        assert.ok(miss.json.elapsedMs >= 50, `DB 조회에 지연 옵션이 적용된다: ${miss.json.elapsedMs}ms`);
        assert.equal(miss.json.data.username, "demo");
        assert.deepEqual(store.get("cache:dashboard:demo"), miss.json.data); // Redis에 저장됐다
        assert.equal(store.ttl("cache:dashboard:demo"), 5000);
        assert.equal(db.calls.length, 1);

        const hit = await get("?mode=redis");
        assert.equal(hit.headers.get("x-cache"), "HIT");
        assert.equal(hit.headers.get("x-source"), "redis");
        assert.equal(hit.json.source, "redis");
        assert.ok(hit.json.elapsedMs < miss.json.elapsedMs && hit.json.elapsedMs < 50, `캐시는 더 빠르다: ${hit.json.elapsedMs}ms < ${miss.json.elapsedMs}ms`);
        assert.deepEqual(hit.json.data, miss.json.data); // 같은 데이터
        assert.equal(db.calls.length, 1, "HIT는 DB를 읽지 않는다");

        const cleared = await request(base, "DELETE", "/api/dashboard/cache", { cookie });
        assert.deepEqual(cleared.json, { deleted: true });
        assert.equal((await get()).headers.get("x-cache"), "MISS");
        assert.equal((await get()).headers.get("x-cache"), "HIT");
        assert.equal(db.calls.length, 2);

        clock.now += 5000; // 캐시 TTL이 지났다
        assert.equal((await get()).headers.get("x-cache"), "MISS");
        assert.equal(db.calls.length, 3);

        assert.deepEqual((await request(base, "DELETE", "/api/dashboard/cache", { cookie })).json, { deleted: true });
        assert.deepEqual((await request(base, "DELETE", "/api/dashboard/cache", { cookie })).json, { deleted: false });
    }));

test("대시보드 mode=db: 매번 DB를 읽고 캐시를 쓰지도 건드리지도 않는다, ?cache=off는 같은 뜻, 알 수 없는 mode는 400", () =>
    withStack(async ({ base, store, db }) => {
        const cookie = sidCookie(await login(base));
        const get = (suffix) => request(base, "GET", `/api/dashboard${suffix}`, { cookie });

        const first = await get("?mode=db");
        const second = await get("?mode=db");
        for (const res of [first, second]) {
            assert.equal(res.status, 200);
            assert.equal(res.headers.get("x-source"), "db");
            assert.equal(res.headers.get("x-cache"), "BYPASS");
            assert.equal(res.json.source, "db");
            assert.ok(res.json.elapsedMs >= 50);
        }
        assert.equal(db.calls.length, 2, "mode=db는 요청마다 DB를 읽는다");
        assert.equal(store.exists("cache:dashboard:demo"), false, "mode=db는 캐시에 쓰지 않는다");

        const legacy = await get("?cache=off"); // 예전 방식과 호환
        assert.equal(legacy.headers.get("x-source"), "db");
        assert.equal(legacy.headers.get("x-cache"), "BYPASS");
        assert.equal(db.calls.length, 3);
        assert.deepEqual(legacy.json.data, first.json.data);

        await get("?mode=redis"); // 캐시를 채운 뒤에도 mode=db는 캐시를 쓰지 않는다
        assert.equal((await get("?mode=db")).headers.get("x-source"), "db");
        assert.equal((await get("?mode=redis&cache=off")).headers.get("x-source"), "redis"); // mode가 있으면 mode가 우선

        for (const bad of ["?mode=memcached", "?mode=", "?mode=DB", "?mode=db,redis"]) {
            const res = await get(bad);
            assert.equal(res.status, 400, bad);
            assert.match(res.json.error, /mode/);
        }
    }));

test("elapsedMs는 정수로 반올림하지 않고 소수 둘째 자리까지 보여 준다", () =>
    withStack(
        async ({ base }) => {
            const cookie = sidCookie(await login(base));
            const values = [];
            for (let i = 0; i < 8; i++) values.push((await request(base, "GET", "/api/dashboard?mode=redis", { cookie })).json.elapsedMs);
            for (const v of values) {
                assert.equal(typeof v, "number");
                assert.ok(v >= 0);
                assert.ok(Math.round(v * 100) === v * 100 || Math.abs(Math.round(v * 100) / 100 - v) < 1e-9, `소수 둘째 자리까지: ${v}`);
            }
            assert.ok(values.some((v) => !Number.isInteger(v)), `정수로 반올림했다면 안 되는 값: ${values}`); // 0.4ms 같은 값이 보여야 한다
        },
        { appOptions: { dashboardDelayMs: 0 } },
    ));

test("DASHBOARD_DELAY_MS의 기본값은 0이라서 인위적인 지연이 없다", async () => {
    const clock = { now: 1_000_000 };
    const store = new Store({ now: () => clock.now });
    const redisServer = createApp(store);
    await listen(redisServer);
    const demo = createDemoApp({ redisClient: new MiniRedisClient({ baseUrl: `http://127.0.0.1:${redisServer.address().port}` }), users: USERS, db: makeStubDb() }); // 지연 옵션을 주지 않는다
    await listen(demo);
    try {
        const base = `http://127.0.0.1:${demo.address().port}`;
        const cookie = sidCookie(await login(base));
        const res = await request(base, "GET", "/api/dashboard?mode=db", { cookie });
        assert.ok(res.json.elapsedMs < 40, `지연 없이 바로 응답한다: ${res.json.elapsedMs}ms`);
    } finally {
        await shutdown(demo, { stopSweeper() {} });
        await shutdown(redisServer, store);
    }
});

test("대시보드에 db 데이터 출처가 없으면 서버를 만들 때 TypeError", () => {
    assert.throws(() => createDemoApp({ redisClient: {}, users: USERS }), TypeError);
    assert.throws(() => createDemoApp({ redisClient: {}, users: USERS, db: {} }), TypeError);
});

test("대시보드 캐시는 사용자별로 분리된다", () =>
    withStack(async ({ base }) => {
        const demo = sidCookie(await login(base));
        const alice = sidCookie(await login(base, "alice", "alice1234"));
        const a = await request(base, "GET", "/api/dashboard", { cookie: demo });
        const b = await request(base, "GET", "/api/dashboard", { cookie: alice });
        assert.equal(b.headers.get("x-cache"), "MISS"); // demo의 캐시가 alice에게 쓰이지 않는다
        assert.equal(a.json.data.username, "demo");
        assert.equal(b.json.data.username, "alice");
    }));

// ---------- 장애와 오류 처리 ----------

test("미니 Redis가 꺼져 있으면 /me, /login, 대시보드는 503이고 인증을 통과시키지 않는다 (fail closed)", () =>
    withStack(async ({ base, stopRedis }) => {
        const cookie = sidCookie(await login(base));
        await stopRedis();

        const me = await request(base, "GET", "/api/me", { cookie });
        assert.equal(me.status, 503);
        assert.deepEqual(me.json, { error: "session store unavailable" });
        assert.equal(me.setCookie.length, 0);

        const attempt = await login(base);
        assert.equal(attempt.status, 503);
        assert.equal(attempt.setCookie.length, 0); // 올바른 비밀번호여도 세션을 만들 수 없으니 쿠키도 없다

        assert.equal((await request(base, "GET", "/api/dashboard", { cookie })).status, 503);

        const out = await request(base, "POST", "/api/logout", { cookie, body: {} });
        assert.equal(out.status, 503); // 서버 세션은 못 지웠다
        assert.match(out.setCookie[0], /Max-Age=0/); // 그래도 브라우저의 쿠키는 지운다

        // 형식이 이상한 쿠키는 저장소를 보지 않으므로 장애와 무관하게 401
        assert.equal((await request(base, "GET", "/api/me", { cookie: "sid=abc" })).status, 401);
    }));

test("예상치 못한 예외는 500 { error: 'internal error' }이고 내부 정보는 응답에 없다", async () => {
    const logs = [];
    const broken = {
        get: async () => {
            throw new Error("secret internal detail /srv/app/db.js");
        },
    };
    const stack = await startStack({ appOptions: { logger: (entry) => logs.push(entry) }, wrapClient: () => broken });
    try {
        const res = await request(stack.base, "GET", "/api/me", { cookie: `sid=${"a".repeat(64)}` });
        assert.equal(res.status, 500);
        assert.deepEqual(res.json, { error: "internal error" });
        assert.ok(!res.text.includes("secret") && !res.text.includes("db.js"));
        assert.match(logs.at(-1).error.message, /secret internal detail/);
    } finally {
        await stack.close();
    }
});

// ---------- 정적 파일 ----------

test("정적 파일: 올바른 Content-Type으로 제공된다", () =>
    withStack(async ({ base }) => {
        const cases = [
            ["/", "text/html; charset=utf-8", /<div id="root">/],
            ["/web/", "text/html; charset=utf-8", /<div id="root">/],
            ["/web/app.js", "text/javascript; charset=utf-8", /FunctionComponent/],
            ["/web/style.css", "text/css; charset=utf-8", /--accent/],
            ["/mini-react/component/function_component.js", "text/javascript; charset=utf-8", /class FunctionComponent/],
            ["/mini-react/hooks/use_state.js", "text/javascript; charset=utf-8", /useState/],
            ["/mini-react/vdom/vdom_create.js", "text/javascript; charset=utf-8", /vnodeToDom/],
        ];
        for (const [urlPath, type, pattern] of cases) {
            const res = await request(base, "GET", urlPath);
            assert.equal(res.status, 200, urlPath);
            assert.equal(res.headers.get("content-type"), type, urlPath);
            assert.match(res.text, pattern, urlPath);
            assert.equal(res.headers.get("x-content-type-options"), "nosniff");
        }
        const html = await request(base, "GET", "/");
        assert.match(html.headers.get("content-security-policy"), /default-src 'self'/);
        const head = await rawGet(base, "/web/app.js", "HEAD");
        assert.equal(head.status, 200);
        assert.equal(head.text, "");
    }));

test("정적 파일: 경로 이탈 시도(.., %2e%2e, %2f, 백슬래시 등)는 모두 404이고 내용이 새지 않는다", () =>
    withStack(async ({ base }) => {
        const attempts = [
            "/mini-react/../package.json",
            "/mini-react/%2e%2e/package.json",
            "/mini-react/%2E%2E/%2E%2E/redis/demo/users.json",
            "/mini-react/..%2fpackage.json",
            "/mini-react/..%2Fpackage.json",
            "/mini-react/..%5cpackage.json",
            "/mini-react/..\\package.json",
            "/mini-react/vdom/../../package.json",
            "/mini-react/vdom/..%2f..%2fpackage.json",
            "/web/../users.json",
            "/web/%2e%2e/users.json",
            "/web/..%2fusers.json",
            "/web/....//users.json",
            "/web/app.js%00.png",
            "/web/%00",
            "/web/C:/Windows/win.ini",
            "/web/app.js::$DATA",
            "/mini-react//etc/passwd",
            "/web/%E0%A4%A", // 잘못된 퍼센트 인코딩
            "/mini-react/.git/config",
            "/web/.env",
        ];
        for (const raw of attempts) {
            const res = await rawGet(base, raw);
            assert.ok(res.status === 404 || res.status === 400, `${raw} → ${res.status}`);
            assert.ok(!res.text.includes('"scripts"') && !res.text.includes('"hash"') && !res.text.includes("salt"), `${raw} 내용이 새면 안 된다`);
        }
    }));

test("정적 파일: 폴더 요청·없는 파일·허용되지 않는 확장자·메서드는 404/405", () =>
    withStack(async ({ base }) => {
        for (const urlPath of ["/mini-react/", "/mini-react/vdom/", "/mini-react/vdom", "/web", "/web/nothing.js", "/elsewhere/app.js"]) {
            const res = await request(base, "GET", urlPath);
            assert.ok(res.status === 404, `${urlPath} → ${res.status}`);
            assert.equal(res.headers.get("content-type"), "application/json"); // 오류는 JSON
        }
        // users.json은 demo 폴더에 있지만 /web은 demo/web만 제공한다
        assert.equal((await request(base, "GET", "/web/users.json")).status, 404);
        const post = await request(base, "POST", "/web/app.js", { body: {} });
        assert.equal(post.status, 405);
        assert.equal(post.headers.get("allow"), "GET, HEAD");
    }));

// ---------- auth.js ----------

test("hashPassword: 평문이 아닌 해시를 만들고, 같은 비밀번호도 salt가 다르면 해시가 다르다", async () => {
    const a = await hashPassword("correct horse");
    const b = await hashPassword("correct horse");
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
    assert.ok(!a.hash.includes("correct") && a.hash !== "correct horse");
    assert.match(a.hash, /^[0-9a-f]{128}$/);
    assert.equal(await verifyPassword("correct horse", a), true);
    assert.equal(await verifyPassword("correct horsf", a), false);
    assert.equal(await verifyPassword("", a), false);
});

test("newSessionId: 64자 hex이고 매번 다르다", () => {
    const ids = new Set(Array.from({ length: 100 }, newSessionId));
    assert.equal(ids.size, 100);
    for (const id of ids) assert.match(id, SESSION_ID_PATTERN);
});

test("parseCookies: 이상한 입력에도 예외 없이 파싱한다", () => {
    assert.equal(parseCookies("sid=abc; theme=dark").get("sid"), "abc");
    assert.equal(parseCookies("a=1; a=2").get("a"), "1"); // 같은 이름은 첫 값
    assert.equal(parseCookies('q="quoted"').get("q"), "quoted");
    assert.equal(parseCookies("k=%ED%95%9C").get("k"), "한");
    assert.equal(parseCookies("k=%E0%A4%A").get("k"), "%E0%A4%A"); // 잘못된 인코딩은 원문 그대로
    assert.equal(parseCookies("__proto__=evil").get("__proto__"), "evil");
    assert.equal({}.evil, undefined); // 전역 객체가 오염되지 않는다
    for (const bad of [undefined, null, 5, "", ";", "=", "===", "a", "=x", " ; ; ", "a=b=c", "\u0000=\u0000"]) assert.doesNotThrow(() => parseCookies(bad), String(bad));
    assert.equal(parseCookies("a=b=c").get("a"), "b=c");
    assert.equal(parseCookies("noequals").size, 0);
});

// ---------- 시드 스크립트와 users.json ----------

test("seedUsers: 평문 비밀번호 없이 해시만 저장하고, 만든 계정으로 검증된다", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mini-redis-seed-"));
    try {
        const file = path.join(dir, "users.json");
        assert.deepEqual(await seedUsers(file), ["demo", "alice"]);
        const text = await readFile(file, "utf8");
        assert.ok(!text.includes("demo1234") && !text.includes("alice1234"));
        const users = await loadUsers(file);
        assert.equal(await verifyPassword("demo1234", users.get("demo")), true);
        assert.equal(await verifyPassword("alice1234", users.get("alice")), true);
        assert.equal(await verifyPassword("demo1234", users.get("alice")), false);
        assert.notEqual(users.get("demo").salt, users.get("alice").salt); // 사용자마다 salt가 다르다
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("demo/users.json에는 테스트 계정 2개가 해시로만 들어 있다", async () => {
    const text = await readFile(path.join(DEMO_DIR, "users.json"), "utf8");
    assert.ok(!text.includes("demo1234") && !text.includes("alice1234"));
    const users = await loadUsers(path.join(DEMO_DIR, "users.json"));
    assert.deepEqual([...users.keys()].sort(), ["alice", "demo"]);
    assert.equal(await verifyPassword("demo1234", users.get("demo")), true);
});
