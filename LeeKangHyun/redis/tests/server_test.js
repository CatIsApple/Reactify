// 파일 이름을 *_test.js로 한 이유: node --test는 찾지만, 루트의 Vitest 기본 패턴(*.test.js)에는 잡히지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp, shutdown } from "../src/server.js";
import { Store } from "../src/store.js";

// 포트 0으로 띄워서 실제 HTTP 요청으로 검증한다. 시계를 주입해 시간을 움직인다.
async function start(options = {}, store) {
    const clock = { now: 1_000_000 };
    store ??= new Store({ now: () => clock.now });
    const server = createApp(store, options);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    return { store, clock, base, server, close: () => shutdown(server, store) };
}

async function call(base, method, path, body) {
    const res = await fetch(base + path, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        /* 본문이 JSON이 아닐 수 있다 (204 등) */
    }
    return { status: res.status, headers: res.headers, json, text };
}

// 서버를 띄우고 테스트 본문을 실행한 뒤 항상 닫는다
async function withApp(run, options, store) {
    const app = await start(options, store);
    try {
        await run(app);
    } finally {
        await app.close();
    }
}

test("PUT/GET/DELETE 기본 흐름과 상태 코드 (201 → 200 → 404)", () =>
    withApp(async ({ base }) => {
        let r = await call(base, "PUT", "/keys/greeting", { value: "hello" });
        assert.equal(r.status, 201);
        assert.deepEqual(r.json, { key: "greeting", ttlMs: null });

        r = await call(base, "GET", "/keys/greeting");
        assert.equal(r.status, 200);
        assert.deepEqual(r.json, { key: "greeting", value: "hello", ttlMs: null });

        r = await call(base, "PUT", "/keys/greeting", { value: "hi" }); // 덮어쓰기
        assert.equal(r.status, 200);
        assert.equal((await call(base, "GET", "/keys/greeting")).json.value, "hi");

        r = await call(base, "DELETE", "/keys/greeting");
        assert.equal(r.status, 200);
        assert.deepEqual(r.json, { deleted: true });

        assert.equal((await call(base, "GET", "/keys/greeting")).status, 404);
        assert.equal((await call(base, "DELETE", "/keys/greeting")).status, 404);
    }));

test("모든 JSON 응답의 Content-Type은 application/json", () =>
    withApp(async ({ base }) => {
        for (const [method, path, body] of [
            ["GET", "/health"],
            ["GET", "/keys/none"],
            ["PUT", "/keys/a", { value: 1 }],
            ["PATCH", "/keys/a"],
            ["GET", "/no/such/path"],
            ["PUT", "/keys/a", "{bad"],
        ]) {
            const r = await call(base, method, path, body);
            assert.equal(r.headers.get("content-type"), "application/json", `${method} ${path}`);
        }
    }));

test("ttl이 지나면 GET이 404 (store 시계를 움직여서 검증)", () =>
    withApp(async ({ base, clock }) => {
        let r = await call(base, "PUT", "/keys/temp", { value: "x", ttlMs: 1000 });
        assert.deepEqual(r.json, { key: "temp", ttlMs: 1000 });
        assert.equal((await call(base, "GET", "/keys/temp")).json.ttlMs, 1000);
        clock.now += 999;
        assert.equal((await call(base, "GET", "/keys/temp")).status, 200);
        clock.now += 1;
        r = await call(base, "GET", "/keys/temp");
        assert.equal(r.status, 404);
        assert.ok(r.json.error);
    }));

test("expire와 ttl 엔드포인트", () =>
    withApp(async ({ base, clock }) => {
        await call(base, "PUT", "/keys/a", { value: 1 });
        let r = await call(base, "GET", "/keys/a/ttl");
        assert.deepEqual(r.json, { key: "a", ttlMs: -1 }); // 만료 없음

        r = await call(base, "POST", "/keys/a/expire", { ttlMs: 5000 });
        assert.equal(r.status, 200);
        assert.deepEqual(r.json, { key: "a", ttlMs: 5000 });
        clock.now += 1500;
        assert.deepEqual((await call(base, "GET", "/keys/a/ttl")).json, { key: "a", ttlMs: 3500 });

        assert.equal((await call(base, "POST", "/keys/none/expire", { ttlMs: 5000 })).status, 404);
        assert.equal((await call(base, "GET", "/keys/none/ttl")).status, 404);
        clock.now += 3500;
        assert.equal((await call(base, "GET", "/keys/a/ttl")).status, 404); // 만료된 키
    }));

test("덮어쓰는 PUT은 이전 ttl을 지운다", () =>
    withApp(async ({ base }) => {
        await call(base, "PUT", "/keys/a", { value: 1, ttlMs: 1000 });
        await call(base, "PUT", "/keys/a", { value: 2 });
        assert.equal((await call(base, "GET", "/keys/a")).json.ttlMs, null);
    }));

test("incr: 없으면 1부터, 이어서 증가", () =>
    withApp(async ({ base }) => {
        assert.deepEqual((await call(base, "POST", "/keys/counter/incr")).json, { key: "counter", value: 1 });
        assert.deepEqual((await call(base, "POST", "/keys/counter/incr")).json, { key: "counter", value: 2 });
        assert.equal((await call(base, "GET", "/keys/counter")).json.value, 2);
    }));

test("값 종류: 문자열, 숫자, 객체, 배열, null", () =>
    withApp(async ({ base }) => {
        const values = ["text", 42, 3.14, { a: 1, nested: { b: [1, 2] } }, [1, "two", null], null, true, ""];
        for (const [i, value] of values.entries()) {
            const key = `v${i}`;
            assert.equal((await call(base, "PUT", `/keys/${key}`, { value })).status, 201);
            const r = await call(base, "GET", `/keys/${key}`);
            assert.equal(r.status, 200, `value ${JSON.stringify(value)}`);
            assert.deepEqual(r.json.value, value);
        }
    }));

test("인코딩된 특수 키: %2F, 한글, 공백, 예약 문자", () =>
    withApp(async ({ base, store }) => {
        const keys = ["a/b", "한글 키", "with space", "q?x=1&y=2", "100%", "__proto__", "a#b"];
        for (const key of keys) {
            const path = `/keys/${encodeURIComponent(key)}`;
            assert.equal((await call(base, "PUT", path, { value: key })).status, 201, key);
            assert.equal(store.get(key), key, `store에는 복원된 키로 저장: ${key}`);
            assert.equal((await call(base, "GET", path)).json.value, key);
        }
        assert.equal((await call(base, "GET", "/stats")).json.size, keys.length);
    }));

test('키 ".."도 경로 정규화로 사라지지 않고 키로 저장된다 (fetch는 ".."를 미리 정규화하므로 원시 요청으로 보낸다)', () =>
    withApp(async ({ base, store }) => {
        const send = (method, body) =>
            new Promise((resolve, reject) => {
                const req = http.request(`${base}/keys/..`, { method, headers: { "Content-Type": "application/json" }, path: "/keys/.." }, (res) => {
                    res.resume();
                    resolve(res.statusCode);
                });
                req.on("error", reject);
                req.end(body);
            });
        assert.equal(await send("PUT", '{"value":"dots"}'), 201);
        assert.equal(store.get(".."), "dots");
        assert.equal(await send("GET"), 200);
    }));

test("잘못된 입력은 400: 잘못된 JSON, 객체가 아닌 본문, value 누락", () =>
    withApp(async ({ base }) => {
        assert.equal((await call(base, "PUT", "/keys/a", "{not json")).status, 400);
        assert.equal((await call(base, "PUT", "/keys/a", "")).status, 400);
        assert.equal((await call(base, "PUT", "/keys/a", "[1,2]")).status, 400);
        assert.equal((await call(base, "PUT", "/keys/a", "null")).status, 400);
        const r = await call(base, "PUT", "/keys/a", { ttlMs: 100 });
        assert.equal(r.status, 400);
        assert.match(r.json.error, /value/);
        assert.equal((await call(base, "GET", "/keys/a")).status, 404); // 저장되지 않았다
        assert.equal((await call(base, "POST", "/keys/a/expire", "{bad")).status, 400);
    }));

test("ttlMs가 양수가 아니면 400 (PUT과 expire)", () =>
    withApp(async ({ base }) => {
        for (const ttlMs of [0, -5, "100", null, 1e999]) {
            const r = await call(base, "PUT", "/keys/a", `{"value":1,"ttlMs":${JSON.stringify(ttlMs)}}`);
            assert.equal(r.status, 400, `PUT ttlMs=${ttlMs}`);
        }
        await call(base, "PUT", "/keys/a", { value: 1 });
        for (const body of [{ ttlMs: 0 }, { ttlMs: -1 }, { ttlMs: "x" }, {}]) {
            assert.equal((await call(base, "POST", "/keys/a/expire", body)).status, 400, JSON.stringify(body));
        }
        assert.equal((await call(base, "GET", "/keys/a")).json.ttlMs, null);
    }));

test("키 검증: 512자는 허용, 513자·빈 키·잘못된 인코딩은 400", () =>
    withApp(async ({ base }) => {
        assert.equal((await call(base, "PUT", `/keys/${"k".repeat(512)}`, { value: 1 })).status, 201);
        assert.equal((await call(base, "PUT", `/keys/${"k".repeat(513)}`, { value: 1 })).status, 400);
        assert.equal((await call(base, "GET", `/keys/${"k".repeat(513)}`)).status, 400);
        assert.equal((await call(base, "GET", "/keys/")).status, 400);
        assert.equal((await call(base, "PUT", "/keys/", { value: 1 })).status, 400);
        assert.equal((await call(base, "GET", "/keys/%E0%A4%A")).status, 400); // 복원할 수 없는 퍼센트 인코딩
    }));

test("본문이 1MB를 넘으면 413 (Content-Length가 있는 경우)", () =>
    withApp(async ({ base }) => {
        const big = `{"value":"${"a".repeat(1024 * 1024)}"}`;
        const r = await call(base, "PUT", "/keys/big", big);
        assert.equal(r.status, 413);
        assert.ok(r.json.error);
        assert.equal((await call(base, "GET", "/keys/big")).status, 404);
        assert.equal((await call(base, "GET", "/health")).status, 200); // 서버는 계속 살아 있다
    }));

test("본문이 1MB를 넘으면 413 (Content-Length 없이 조각으로 보내는 경우)", () =>
    withApp(async ({ base }) => {
        const status = await new Promise((resolve, reject) => {
            const req = http.request(`${base}/keys/big`, { method: "PUT", headers: { "Content-Type": "application/json" } }, (res) => {
                res.resume();
                resolve(res.statusCode);
            });
            req.on("error", reject);
            req.write('{"value":"');
            const piece = "a".repeat(64 * 1024);
            for (let i = 0; i < 20; i++) req.write(piece); // 약 1.25MB
            req.end('"}');
        });
        assert.equal(status, 413);
        assert.equal((await call(base, "GET", "/health")).status, 200);
    }));

test("작은 maxBodyBytes 옵션이 적용된다", () =>
    withApp(
        async ({ base }) => {
            assert.equal((await call(base, "PUT", "/keys/a", { value: "x".repeat(100) })).status, 413);
            assert.equal((await call(base, "PUT", "/keys/a", { value: "x" })).status, 201);
        },
        { maxBodyBytes: 64 },
    ));

test("지원하지 않는 메서드는 405와 Allow 헤더, 없는 경로는 404", () =>
    withApp(async ({ base }) => {
        let r = await call(base, "PATCH", "/keys/a");
        assert.equal(r.status, 405);
        assert.equal(r.headers.get("allow"), "PUT, GET, DELETE");
        r = await call(base, "GET", "/keys/a/incr");
        assert.equal(r.status, 405);
        assert.equal(r.headers.get("allow"), "POST");
        assert.equal((await call(base, "POST", "/health")).status, 405);
        assert.equal((await call(base, "GET", "/nothing")).status, 404);
        assert.equal((await call(base, "GET", "/keys")).status, 404);
        assert.equal((await call(base, "GET", "/keys/a/unknown")).status, 404);
    }));

test("OPTIONS 프리플라이트는 204와 CORS 헤더", () =>
    withApp(async ({ base }) => {
        const r = await call(base, "OPTIONS", "/keys/a");
        assert.equal(r.status, 204);
        assert.equal(r.text, "");
        assert.equal(r.headers.get("access-control-allow-origin"), "*");
        assert.match(r.headers.get("access-control-allow-methods"), /PUT/);
        assert.match(r.headers.get("access-control-allow-headers"), /Content-Type/i);
    }));

test("일반 응답에도 CORS 헤더가 붙고, corsOrigin 옵션으로 바꿀 수 있다", async () => {
    await withApp(async ({ base }) => {
        assert.equal((await call(base, "GET", "/health")).headers.get("access-control-allow-origin"), "*");
    });
    await withApp(
        async ({ base }) => {
            assert.equal((await call(base, "GET", "/health")).headers.get("access-control-allow-origin"), "http://localhost:5173");
            assert.equal((await call(base, "GET", "/keys/none")).headers.get("access-control-allow-origin"), "http://localhost:5173");
        },
        { corsOrigin: "http://localhost:5173" },
    );
});

test("health와 stats", () =>
    withApp(async ({ base, clock }) => {
        assert.deepEqual((await call(base, "GET", "/health")).json, { status: "ok" });
        assert.deepEqual((await call(base, "GET", "/stats")).json, { size: 0 });
        await call(base, "PUT", "/keys/a", { value: 1, ttlMs: 100 });
        await call(base, "PUT", "/keys/b", { value: 2 });
        assert.equal((await call(base, "GET", "/stats")).json.size, 2);
        clock.now += 100;
        assert.equal((await call(base, "GET", "/stats")).json.size, 1); // 만료된 항목은 세지 않는다
    }));

test("동시성: 같은 키에 POST /incr 200개를 동시에 보내도 최종 값은 정확히 200", () =>
    withApp(async ({ base }) => {
        const results = await Promise.all(Array.from({ length: 200 }, () => call(base, "POST", "/keys/hits/incr")));
        assert.ok(results.every((r) => r.status === 200));
        const values = results.map((r) => r.json.value).sort((a, b) => a - b);
        assert.deepEqual(values, Array.from({ length: 200 }, (_, i) => i + 1)); // 중복·유실 없이 1..200
        assert.equal((await call(base, "GET", "/keys/hits")).json.value, 200);
    }));

test("예상치 못한 예외는 500 { error: 'internal error' }이고 내부 정보는 응답에 없다", async () => {
    const logs = [];
    const broken = {
        get() {
            throw new Error("secret internal detail /home/user/app.js");
        },
        ttl: () => -2,
        stopSweeper() {}, // shutdown이 호출하므로 필요하다
    };
    await withApp(
        async ({ base }) => {
            const r = await call(base, "GET", "/keys/a");
            assert.equal(r.status, 500);
            assert.deepEqual(r.json, { error: "internal error" });
            assert.ok(!r.text.includes("secret"));
            assert.ok(!r.text.includes("app.js"));
            assert.ok(!r.text.includes(" at "));
            assert.equal(r.headers.get("content-type"), "application/json");
            assert.match(logs.at(-1).error.message, /secret internal detail/); // 로그에는 남는다
        },
        { logger: (entry) => logs.push(entry) },
        broken,
    );
});

test("logger 옵션: 요청마다 method, path, status가 전달된다", async () => {
    const logs = [];
    await withApp(
        async ({ base }) => {
            await call(base, "GET", "/health");
            await call(base, "GET", "/keys/none");
        },
        { logger: (entry) => logs.push(entry) },
    );
    assert.deepEqual(logs.map((l) => [l.method, l.path, l.status]), [["GET", "/health", 200], ["GET", "/keys/none", 404]]);
});

test("shutdown 뒤에는 새 연결을 받지 않는다", async () => {
    const app = await start();
    assert.equal((await call(app.base, "GET", "/health")).status, 200);
    await app.close();
    await assert.rejects(() => fetch(`${app.base}/health`));
});
