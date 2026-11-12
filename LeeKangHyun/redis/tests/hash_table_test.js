// 파일 이름을 *_test.js로 한 이유: node --test는 찾지만, 루트의 Vitest 기본 패턴(*.test.js)에는 잡히지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HashTable, fnv1a } from "../src/hash_table.js";

test("set/get/has/size 기본 동작", () => {
    const t = new HashTable();
    t.set("a", 1);
    t.set("b", "two");
    assert.equal(t.get("a"), 1);
    assert.equal(t.get("b"), "two");
    assert.equal(t.has("a"), true);
    assert.equal(t.size, 2);
});

test("같은 키를 다시 set하면 덮어쓰고 size는 그대로", () => {
    const t = new HashTable();
    t.set("a", 1);
    t.set("a", 2);
    assert.equal(t.get("a"), 2);
    assert.equal(t.size, 1);
});

test("delete는 지웠으면 true, 없으면 false", () => {
    const t = new HashTable();
    t.set("a", 1);
    assert.equal(t.delete("a"), true);
    assert.equal(t.delete("a"), false);
    assert.equal(t.get("a"), undefined);
    assert.equal(t.has("a"), false);
    assert.equal(t.size, 0);
});

test("없는 키는 get이 undefined, has가 false", () => {
    const t = new HashTable();
    assert.equal(t.get("none"), undefined);
    assert.equal(t.has("none"), false);
});

test("값이 undefined여도 has로 키의 존재를 구분한다", () => {
    const t = new HashTable();
    t.set("a", undefined);
    assert.equal(t.has("a"), true);
    assert.equal(t.get("a"), undefined);
});

test("강제 충돌: 모든 키가 같은 버킷에 들어가도 각각 조회·덮어쓰기·삭제된다", () => {
    const t = new HashTable(64, () => 0); // 해시가 항상 0 → 전부 0번 버킷
    t.set("a", 1);
    t.set("b", 2);
    t.set("c", 3);
    assert.equal(t.get("a"), 1);
    assert.equal(t.get("b"), 2);
    assert.equal(t.get("c"), 3);
    t.set("b", 20);
    assert.equal(t.get("b"), 20);
    assert.equal(t.size, 3);
    assert.equal(t.delete("b"), true); // 체인 가운데 삭제
    assert.equal(t.get("a"), 1);
    assert.equal(t.get("c"), 3);
    assert.equal(t.has("b"), false);
    assert.deepEqual(t.keys().sort(), ["a", "c"]);
});

test("적재율 0.75를 넘을 때만 버킷 수를 2배로 늘린다", () => {
    const t = new HashTable(4);
    t.set("a", 1);
    t.set("b", 2);
    t.set("c", 3); // 3/4 = 0.75, 넘지 않음
    assert.equal(t.capacity, 4);
    t.set("d", 4); // 4/4 = 1.0 > 0.75
    assert.equal(t.capacity, 8);
    for (const [k, v] of [["a", 1], ["b", 2], ["c", 3], ["d", 4]]) assert.equal(t.get(k), v);
});

test("1만 개 이상 넣어 여러 번 resize해도 모두 조회된다", () => {
    const t = new HashTable(8);
    const n = 12000;
    for (let i = 0; i < n; i++) t.set(`key:${i}`, i);
    assert.equal(t.size, n);
    assert.ok(t.capacity > 8);
    assert.ok(t.size / t.capacity <= 0.75);
    for (let i = 0; i < n; i++) assert.equal(t.get(`key:${i}`), i);
    assert.equal(t.keys().length, n);
    assert.equal(new Set(t.keys()).size, n);
});

test("resize 뒤에도 삭제가 정상 동작한다", () => {
    const t = new HashTable(2);
    for (let i = 0; i < 100; i++) t.set(`k${i}`, i);
    for (let i = 0; i < 100; i += 2) assert.equal(t.delete(`k${i}`), true);
    assert.equal(t.size, 50);
    assert.equal(t.get("k1"), 1);
    assert.equal(t.get("k2"), undefined);
});

test('특수 키 "__proto__", "constructor" 등도 일반 키처럼 동작한다', () => {
    const t = new HashTable();
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "prototype"]) {
        assert.equal(t.has(key), false);
        t.set(key, `value-${key}`);
        assert.equal(t.get(key), `value-${key}`);
        assert.equal(t.has(key), true);
    }
    assert.equal(t.size, 5);
    t.set("__proto__", { polluted: true });
    assert.equal({}.polluted, undefined); // Object.prototype이 오염되지 않는다
    assert.equal(t.delete("__proto__"), true);
    assert.equal(t.has("__proto__"), false);
});

test("빈 문자열이나 문자열이 아닌 키는 TypeError", () => {
    const t = new HashTable();
    for (const bad of ["", 1, null, undefined, {}, [], Symbol("s")]) {
        assert.throws(() => t.set(bad, 1), TypeError);
        assert.throws(() => t.get(bad), TypeError);
        assert.throws(() => t.has(bad), TypeError);
        assert.throws(() => t.delete(bad), TypeError);
    }
});

test("잘못된 생성자 인자", () => {
    assert.throws(() => new HashTable(0), RangeError);
    assert.throws(() => new HashTable(1.5), RangeError);
    assert.throws(() => new HashTable(8, "not a function"), TypeError);
});

test("fnv1a: 같은 입력은 같은 해시, 부호 없는 정수, 다른 입력은 (대체로) 다른 해시", () => {
    assert.equal(fnv1a("hello"), fnv1a("hello"));
    assert.ok(Number.isInteger(fnv1a("hello")) && fnv1a("hello") >= 0);
    assert.notEqual(fnv1a("a"), fnv1a("b"));
    assert.equal(fnv1a(""), 0x811c9dc5); // 빈 문자열은 시작값 그대로 (FNV 표준값)
    assert.equal(fnv1a("a"), 0xe40c292c); // FNV-1a 32비트 공개 테스트 벡터
});
