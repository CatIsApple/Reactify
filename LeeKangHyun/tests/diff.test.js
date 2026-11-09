import { describe, test, expect } from "vitest";
import { diff } from "../src/diff/diff.js";

const el = (type, props = {}, ...children) => ({ type, props, children });

describe("diff", () => {
    test("변경 없음: 빈 배열", () => {
        const v = el("div", { id: "a" }, "hi", el("p", {}, "x"));
        expect(diff(v, structuredClone(v))).toEqual([]);
    });

    test("REPLACE: type이 다르면 통째로 교체", () => {
        expect(diff(el("p"), el("span"))).toEqual([{ op: "REPLACE", path: [], vnode: el("span") }]);
    });

    test("REPLACE: 문자열 <-> 태그", () => {
        expect(diff(el("div", {}, "a"), el("div", {}, el("b")))).toEqual([
            { op: "REPLACE", path: [0], vnode: el("b") },
        ]);
    });

    test("TEXT: 문자열 내용 변경", () => {
        expect(diff(el("p", {}, "a"), el("p", {}, "b"))).toEqual([{ op: "TEXT", path: [0], text: "b" }]);
    });

    test("PROPS: 추가·변경·삭제는 바뀐 것만 담는다", () => {
        const o = el("div", { id: "a", class: "x", title: "t" });
        const n = el("div", { id: "a", class: "y", lang: "ko" });
        expect(diff(o, n)).toEqual([{ op: "PROPS", path: [], set: { class: "y", lang: "ko" }, remove: ["title"] }]);
    });

    test("CREATE: 새 자식이 더 길면 추가", () => {
        expect(diff(el("ul", {}, el("li")), el("ul", {}, el("li"), el("li", {}, "n")))).toEqual([
            { op: "CREATE", path: [1], vnode: el("li", {}, "n") },
        ]);
    });

    test("REMOVE: 여러 개면 인덱스 내림차순", () => {
        const o = el("ul", {}, el("li"), el("li"), el("li"));
        expect(diff(o, el("ul", {}, el("li")))).toEqual([
            { op: "REMOVE", path: [2] },
            { op: "REMOVE", path: [1] },
        ]);
    });

    test("중첩 구조: 깊은 path를 따라간다", () => {
        const o = el("div", {}, el("ul", {}, el("li", {}, "a"), el("li", {}, "b")));
        const n = el("div", {}, el("ul", {}, el("li", {}, "a"), el("li", { class: "on" }, "c")));
        expect(diff(o, n)).toEqual([
            { op: "PROPS", path: [0, 1], set: { class: "on" }, remove: [] },
            { op: "TEXT", path: [0, 1, 0], text: "c" },
        ]);
    });
});
