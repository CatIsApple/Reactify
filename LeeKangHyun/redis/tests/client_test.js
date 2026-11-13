// 파일 이름을 *_test.js로 한 이유: node --test는 찾지만, 루트의 Vitest 기본 패턴(*.test.js)에는 잡히지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp, shutdown } from "../src/server.js";
import { Store } from "../src/store.js";
import { MiniRedisClient, RedisHttpError, RedisTimeoutError, RedisUnavailableError } from "../src/client.js";

async function withRedis(run) {
    const clock = { now: 1_000_000 };
    const store = new Store({ now: () => clock.now });
    const server = createApp(store);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        await run({ client: new MiniRedisClient({ baseUrl }), store, clock, baseUrl });
    } finally {
        await shutdown(server, store);
    }
}

test("set/get: 문자열, 숫자, 객체, 배열, null 값을 주고받는다", () =>
    withRedis(async ({ client }) => {
        for (const [i, value] of ["text", 42, { a: [1, { b: 2 }] }, [1, 2], null, ""].entries()) {
            await client.set(`k${i}`, value);
            assert.deepEqual(await client.get(`k${i}`), value);
        }
    }));

test("get: 없는 키는 undefined (null 값과 구분된다)", () =>
    withRedis(async ({ client }) => {
        assert.equal(await client.get("missing"), undefined);
        await client.set("n", null);
        assert.equal(await client.get("n"), null);
    }));

test("set의 ttlMs: 시간이 지나면 get이 undefined", () =>
    withRedis(async ({ client, clock }) => {
        await client.set("a", 1, 1000);
        assert.equal(await client.get("a"), 1);
        clock.now += 1000;
        assert.equal(await client.get("a"), undefined);
    }));

test("del: 지웠으면 true, 없으면 false", () =>
    withRedis(async ({ client }) => {
        await client.set("a", 1);
        assert.equal(await client.del("a"), true);
        assert.equal(await client.del("a"), false);
        assert.equal(await client.get("a"), undefined);
    }));

test("expire와 ttl: 만료 없음 -1, 설정 후 남은 ms, 없는 키 -2", () =>
    withRedis(async ({ client, clock }) => {
        await client.set("a", 1);
        assert.equal(await client.ttl("a"), -1);
        assert.equal(await client.expire("a", 5000), true);
        assert.equal(await client.ttl("a"), 5000);
        clock.now += 1200;
        assert.equal(await client.ttl("a"), 3800);
        assert.equal(await client.expire("none", 5000), false);
        assert.equal(await client.ttl("none"), -2);
        clock.now += 3800;
        assert.equal(await client.ttl("a"), -2);
    }));

test("incr: 없으면 1부터", () =>
    withRedis(async ({ client }) => {
        assert.equal(await client.incr("c"), 1);
        assert.equal(await client.incr("c"), 2);
        assert.equal(await client.get("c"), 2);
    }));

test("키는 encodeURIComponent로 인코딩되어 특수 문자도 그대로 저장된다", () =>
    withRedis(async ({ client, store }) => {
        for (const key of ["a/b", "한글 키", "q?x=1&y=2", "100%", "session:abc", "a#b"]) {
            await client.set(key, key);
            assert.equal(store.get(key), key); // 서버 쪽에도 원래 키로 저장됐다
            assert.equal(await client.get(key), key);
        }
    }));

test("서버가 4xx를 돌려주면 status를 가진 RedisHttpError", () =>
    withRedis(async ({ client }) => {
        await assert.rejects(
            () => client.set("", 1), // 빈 키는 서버가 400
            (err) => err instanceof RedisHttpError && err.status === 400,
        );
        await assert.rejects(
            () => client.set("a", 1, -5), // 잘못된 ttl도 400
            (err) => err instanceof RedisHttpError && err.status === 400,
        );
    }));

test("응답이 없으면 RedisTimeoutError (RedisUnavailableError의 한 종류)", async () => {
    const hanging = http.createServer(() => {}); // 요청을 받고 아무 응답도 하지 않는다
    await new Promise((resolve) => hanging.listen(0, "127.0.0.1", resolve));
    try {
        const client = new MiniRedisClient({ baseUrl: `http://127.0.0.1:${hanging.address().port}`, timeoutMs: 50 });
        const started = Date.now();
        await assert.rejects(
            () => client.get("a"),
            (err) => err instanceof RedisTimeoutError && err instanceof RedisUnavailableError,
        );
        assert.ok(Date.now() - started < 1500);
    } finally {
        hanging.closeAllConnections();
        await new Promise((resolve) => hanging.close(resolve));
    }
});

test("연결할 수 없으면 RedisUnavailableError (타임아웃과는 다른 에러)", async () => {
    const probe = http.createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address();
    await new Promise((resolve) => probe.close(resolve)); // 이제 이 포트는 닫혀 있다

    const client = new MiniRedisClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 1000 });
    for (const call of [() => client.get("a"), () => client.set("a", 1), () => client.del("a"), () => client.incr("a"), () => client.ttl("a"), () => client.expire("a", 10)]) {
        await assert.rejects(call, (err) => err instanceof RedisUnavailableError && !(err instanceof RedisTimeoutError));
    }
});

test("baseUrl이 없으면 TypeError, 끝의 /는 무시한다", () =>
    withRedis(async ({ baseUrl }) => {
        assert.throws(() => new MiniRedisClient({}), TypeError);
        const client = new MiniRedisClient({ baseUrl: `${baseUrl}/` });
        await client.set("a", 1);
        assert.equal(await client.get("a"), 1);
    }));
