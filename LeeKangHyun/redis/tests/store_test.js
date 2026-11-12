// 파일 이름을 *_test.js로 한 이유: node --test는 찾지만, 루트의 Vitest 기본 패턴(*.test.js)에는 잡히지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";

// 주입한 시계로 시간을 마음대로 움직인다
function makeStore(start = 1000) {
    const clock = { now: start };
    const store = new Store({ now: () => clock.now });
    return { store, clock };
}

test("set/get/del 기본 동작", () => {
    const { store } = makeStore();
    store.set("a", "hello");
    assert.equal(store.get("a"), "hello");
    assert.equal(store.del("a"), true);
    assert.equal(store.get("a"), undefined);
    assert.equal(store.del("a"), false);
});

test("문자열, 숫자, 객체, 배열 값을 저장하고, 저장 뒤 원본을 바꿔도 영향이 없다", () => {
    const { store } = makeStore();
    const obj = { name: "kim", tags: ["a", "b"] };
    store.set("n", 42);
    store.set("o", obj);
    store.set("arr", [1, 2, 3]);
    obj.name = "changed";
    assert.equal(store.get("n"), 42);
    assert.deepEqual(store.get("o"), { name: "kim", tags: ["a", "b"] });
    assert.deepEqual(store.get("arr"), [1, 2, 3]);
    store.get("o").tags.push("c"); // 꺼낸 값을 바꿔도 저장된 값은 그대로
    assert.deepEqual(store.get("o").tags, ["a", "b"]);
});

test("JSON으로 저장할 수 없는 값은 TypeError", () => {
    const { store } = makeStore();
    assert.throws(() => store.set("a", undefined), TypeError);
    assert.throws(() => store.set("a", () => {}), TypeError);
    assert.equal(store.exists("a"), false);
});

test("exists", () => {
    const { store } = makeStore();
    assert.equal(store.exists("a"), false);
    store.set("a", 1);
    assert.equal(store.exists("a"), true);
});

test("만료 전에는 get이 값을, 만료 후에는 undefined를 돌려준다", () => {
    const { store, clock } = makeStore();
    store.set("a", "v", 500);
    clock.now += 499;
    assert.equal(store.get("a"), "v");
    clock.now += 1; // 정확히 만료 시각
    assert.equal(store.get("a"), undefined);
    assert.equal(store.exists("a"), false);
});

test("lazy expiration: get이 만료된 항목을 그 자리에서 지운다", () => {
    const { store, clock } = makeStore();
    store.set("a", 1, 100);
    clock.now += 100;
    assert.equal(store.get("a"), undefined);
    assert.equal(store.sweep(), 0); // 이미 get이 지웠으니 sweep할 게 없다
});

test("ttl: 남은 ms / 만료 없음 -1 / 없거나 만료됨 -2", () => {
    const { store, clock } = makeStore();
    store.set("a", 1, 1000);
    assert.equal(store.ttl("a"), 1000);
    clock.now += 300;
    assert.equal(store.ttl("a"), 700);
    store.set("forever", 1);
    assert.equal(store.ttl("forever"), -1);
    assert.equal(store.ttl("none"), -2);
    clock.now += 700;
    assert.equal(store.ttl("a"), -2);
});

test("expire: 기존 키에 만료를 걸면 true, 없는 키는 false", () => {
    const { store, clock } = makeStore();
    store.set("a", 1);
    assert.equal(store.expire("a", 200), true);
    assert.equal(store.ttl("a"), 200);
    clock.now += 200;
    assert.equal(store.get("a"), undefined);
    assert.equal(store.expire("a", 200), false); // 이미 만료된 키
    assert.equal(store.expire("none", 200), false);
});

test("expire로 이미 걸린 만료 시간을 연장할 수 있다", () => {
    const { store, clock } = makeStore();
    store.set("a", 1, 100);
    clock.now += 50;
    store.expire("a", 100);
    clock.now += 99;
    assert.equal(store.get("a"), 1);
});

test("덮어쓰기 set은 이전 ttl을 지운다", () => {
    const { store, clock } = makeStore();
    store.set("a", 1, 100);
    store.set("a", 2);
    assert.equal(store.ttl("a"), -1);
    clock.now += 1000;
    assert.equal(store.get("a"), 2);
});

test("만료된 키를 다시 set하면 새 값이 보인다", () => {
    const { store, clock } = makeStore();
    store.set("a", "old", 100);
    clock.now += 100;
    store.set("a", "new");
    assert.equal(store.get("a"), "new");
});

test("incr: 없으면 0에서 시작, 증가 후 값을 반환", () => {
    const { store } = makeStore();
    assert.equal(store.incr("c"), 1);
    assert.equal(store.incr("c"), 2);
    assert.equal(store.get("c"), 2);
    store.set("n", 10);
    assert.equal(store.incr("n"), 11);
});

test("incr: 숫자가 아닌 값이면 0에서 시작하고, 기존 만료 시간은 유지한다", () => {
    const { store, clock } = makeStore();
    store.set("s", "text", 1000);
    assert.equal(store.incr("s"), 1);
    assert.equal(store.ttl("s"), 1000);
    clock.now += 1000;
    assert.equal(store.incr("s"), 1); // 만료된 키는 새로 시작
});

test("incr: 이벤트 루프에서 겹쳐 실행되는 호출들도 값이 유실되지 않는다", async () => {
    const { store } = makeStore();
    await Promise.all(Array.from({ length: 1000 }, async () => store.incr("hits")));
    assert.equal(store.get("hits"), 1000);
});

test("sweep은 만료된 항목만 지우고 지운 개수를 반환", () => {
    const { store, clock } = makeStore();
    store.set("a", 1, 100);
    store.set("b", 2, 100);
    store.set("c", 3, 5000);
    store.set("d", 4);
    clock.now += 100;
    assert.equal(store.sweep(), 2);
    assert.equal(store.get("c"), 3);
    assert.equal(store.get("d"), 4);
    assert.equal(store.sweep(), 0);
});

test("size는 만료된 항목을 세지 않는다", () => {
    const { store, clock } = makeStore();
    store.set("a", 1, 100);
    store.set("b", 2);
    assert.equal(store.size(), 2);
    clock.now += 100;
    assert.equal(store.size(), 1);
});

test("잘못된 ttl은 RangeError", () => {
    const { store } = makeStore();
    for (const bad of [0, -1, NaN, Infinity, "100", null]) {
        assert.throws(() => store.set("a", 1, bad), RangeError, String(bad));
    }
    store.set("a", 1);
    for (const bad of [0, -5, NaN, Infinity, "10", undefined]) {
        assert.throws(() => store.expire("a", bad), RangeError, String(bad));
    }
    assert.throws(() => store.startSweeper(0), RangeError);
});

test("잘못된 키는 TypeError", () => {
    const { store } = makeStore();
    assert.throws(() => store.set("", 1), TypeError);
    assert.throws(() => store.get(1), TypeError);
});

test('특수 키 "__proto__"도 값을 저장·조회·삭제할 수 있다', () => {
    const { store } = makeStore();
    store.set("__proto__", "safe");
    assert.equal(store.get("__proto__"), "safe");
    assert.equal(store.del("__proto__"), true);
});

test("startSweeper는 주기적으로 만료 항목을 지우고, stopSweeper로 멈춘다", async () => {
    const { store, clock } = makeStore();
    store.set("a", 1, 10);
    clock.now += 10; // 주입한 시계로는 이미 만료
    store.startSweeper(5);
    store.startSweeper(5); // 두 번 시작해도 타이머는 하나
    await new Promise((resolve) => setTimeout(resolve, 40));
    store.stopSweeper();
    store.stopSweeper(); // 두 번 멈춰도 에러 없음
    assert.equal(store.sweep(), 0); // 이미 sweeper가 지웠다
    assert.equal(store.size(), 0);
});
