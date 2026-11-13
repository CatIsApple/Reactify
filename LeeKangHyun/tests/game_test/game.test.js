// @vitest-environment jsdom
import { describe, test, expect } from "vitest";
import { FunctionComponent } from "../../src/component/function_component.js";
import { diff } from "../../src/diff/diff.js";
import { App, HOOK_NAMES } from "./game_app.js";
import { EMOJIS, createDeck, shuffle, canFlip, isMatch } from "./game_logic.js";
import { countNodes, describePatch, changedKeys, meaningfulPatches, treeLines, explainPath, patchChanges, hookKind, hookRows, formatValue } from "./inspector.js";

describe("게임 규칙", () => {
    test("덱: 이모지 8쌍 = 16장, id는 모두 다르다", () => {
        const deck = createDeck();
        expect(deck.length).toBe(16);
        expect(new Set(deck.map((c) => c.id)).size).toBe(16);
        for (const e of EMOJIS) expect(deck.filter((c) => c.emoji === e).length).toBe(2);
    });

    test("shuffle: 원본을 바꾸지 않고 같은 원소를 다른 순서로 돌려준다", () => {
        const src = [1, 2, 3, 4, 5, 6];
        const out = shuffle(src, () => 0);
        expect(src).toEqual([1, 2, 3, 4, 5, 6]);
        expect([...out].sort()).toEqual([1, 2, 3, 4, 5, 6]);
        expect(out).not.toEqual(src);
    });

    test("매칭 판정: 같은 이모지의 서로 다른 두 장만 맞는다", () => {
        const cards = [
            { id: 0, emoji: "A" },
            { id: 1, emoji: "A" },
            { id: 2, emoji: "B" },
        ];
        expect(isMatch(cards, 0, 1)).toBe(true);
        expect(isMatch(cards, 0, 2)).toBe(false);
        expect(isMatch(cards, 0, 0)).toBe(false);
        expect(isMatch(cards, 0, 99)).toBe(false);
    });

    test("클릭 무시 규칙: 두 장 열림 / 이미 열림 / 이미 맞춤", () => {
        expect(canFlip({ flipped: [], matched: [] }, 1)).toBe(true);
        expect(canFlip({ flipped: [1], matched: [] }, 2)).toBe(true);
        expect(canFlip({ flipped: [1], matched: [] }, 1)).toBe(false);
        expect(canFlip({ flipped: [1, 2], matched: [] }, 3)).toBe(false);
        expect(canFlip({ flipped: [], matched: [4] }, 4)).toBe(false);
    });
});

// ---- App 흐름: 타이머를 직접 제어하고, 섞기는 고정해서 카드 위치를 안다 ----
function withGame(run) {
    const timeouts = new Map();
    let next = 1;
    const saved = { st: globalThis.setTimeout, ct: globalThis.clearTimeout, random: Math.random };
    globalThis.setTimeout = (fn) => (timeouts.set(next, fn), next++);
    globalThis.clearTimeout = (id) => void timeouts.delete(id);
    Math.random = () => 0;
    try {
        const container = document.createElement("div");
        const c = new FunctionComponent(App);
        c.mount(container);
        run({
            c,
            container,
            deck: createDeck(() => 0), // App이 만드는 덱과 같다
            cards: () => [...container.querySelectorAll(".card")],
            text: (sel) => container.querySelector(sel).textContent,
            timeouts,
        });
    } finally {
        globalThis.setTimeout = saved.st;
        globalThis.clearTimeout = saved.ct;
        Math.random = saved.random;
    }
}
const pairOf = (deck, i) => deck.findIndex((c, j) => j !== i && c.emoji === deck[i].emoji);

describe("App", () => {
    test("초기 렌더: 카드 16장이 모두 뒷면", () => {
        withGame(({ cards, text }) => {
            expect(cards().length).toBe(16);
            expect(cards().every((el) => el.className === "card" && el.textContent === "?")).toBe(true);
            expect(text(".stats")).toBe("시도 0번 · 맞춘 쌍 0/8");
        });
    });

    test("같은 두 장은 matched로 고정되고 다시 눌러도 무시된다", () => {
        withGame(({ cards, deck, text, timeouts }) => {
            const j = pairOf(deck, 0);
            cards()[0].click();
            expect(cards()[0].className).toBe("card flipped");
            cards()[j].click();
            expect(cards()[0].className).toBe("card matched");
            expect(cards()[j].className).toBe("card matched");
            expect(text(".stats")).toBe("시도 1번 · 맞춘 쌍 1/8");
            expect(timeouts.size).toBe(0); // 되돌리는 타이머가 취소됐다
            cards()[0].click();
            expect(text(".stats")).toBe("시도 1번 · 맞춘 쌍 1/8");
        });
    });

    test("다른 두 장은 열려 있는 동안 추가 클릭을 무시하고 800ms 뒤 다시 뒤집힌다", () => {
        withGame(({ cards, deck, text, timeouts }) => {
            const j = pairOf(deck, 0);
            const other = deck.findIndex((c, k) => k !== 0 && k !== j);
            const third = deck.findIndex((c, k) => k !== 0 && k !== j && k !== other);
            cards()[0].click();
            cards()[other].click();
            expect(cards()[0].className).toBe("card flipped");
            expect(cards()[other].className).toBe("card flipped");
            cards()[third].click(); // 비교 중 → 무시
            expect(cards()[third].className).toBe("card");
            expect(text(".stats")).toBe("시도 1번 · 맞춘 쌍 0/8");
            expect(timeouts.size).toBe(1);
            [...timeouts.values()][0]();
            expect(cards()[0].className).toBe("card");
            expect(cards()[0].textContent).toBe("?");
            expect(cards()[other].className).toBe("card");
        });
    });

    test("모두 맞추면 승리 문구, 다시 시작하면 초기화", () => {
        withGame(({ cards, deck, text, container }) => {
            const done = new Set();
            for (let i = 0; i < 16; i++) {
                if (done.has(i)) continue;
                const j = pairOf(deck, i);
                cards()[i].click();
                cards()[j].click();
                done.add(i).add(j);
            }
            expect(text(".message")).toContain("모두 맞췄어요");
            expect(text(".stats")).toBe("시도 8번 · 맞춘 쌍 8/8");
            [...container.querySelectorAll(".controls button")][0].click();
            expect(text(".message")).toBe("");
            expect(text(".stats")).toBe("시도 0번 · 맞춘 쌍 0/8");
            expect(cards().every((el) => el.className === "card")).toBe(true);
        });
    });

    test("자식 컴포넌트에는 훅이 없다 (렌더 밖에서 호출해도 에러 없음)", async () => {
        const { Card, Board, Stats, Message, Controls } = await import("./game_app.js");
        const noop = () => {};
        const card = { id: 0, emoji: "🐶" };
        expect(Card({ card, open: false, matched: false, onFlip: noop }).type).toBe("button");
        expect(Board({ cards: [card], flipped: [], matched: [], onFlip: noop }).children.length).toBe(1);
        expect(Stats({ moves: 0, pairs: 0, total: 8 }).type).toBe("p");
        expect(Message({ won: false, moves: 0 }).type).toBe("p");
        expect(Controls({ onRestart: noop }).type).toBe("div");
    });
});

describe("inspector (패널용 순수 함수)", () => {
    test("카드 한 장을 뒤집으면 의미 있는 패치는 class PROPS와 TEXT 둘뿐이다", () => {
        withGame(({ c, cards }) => {
            const before = c.oldVNode;
            cards()[3].click();
            const patches = diff(before, c.oldVNode);
            expect(patches.length).toBeGreaterThan(2); // 핸들러 교체 PROPS가 섞여 있다
            const real = meaningfulPatches(patches);
            expect(real.map((p) => p.op)).toEqual(["PROPS", "TEXT"]);
            const lines = real.flatMap((p) => describePatch(p, before));
            expect(lines[0]).toBe("PROPS [1,3] class: card → card flipped");
            expect(lines[1]).toMatch(/^TEXT \[1,3,0\] \? → .+/);
            expect([...changedKeys(patches)].sort()).toEqual(["1,3", "1,3,0"]);
        });
    });

    test("노드 수 세기와 트리 줄 만들기", () => {
        const tree = { type: "div", props: { class: "a", onClick: () => {} }, children: ["x", { type: "p", props: {}, children: ["y"] }] };
        expect(countNodes(tree)).toBe(4);
        const lines = treeLines(tree, new Set(["1,0"]));
        expect(lines.map((l) => l.text)).toEqual(['<div class="a">', '  "x"', "  <p>", '    "y"']);
        expect(lines.map((l) => l.changed)).toEqual([false, false, false, true]);
    });

    test("REPLACE / CREATE / REMOVE 설명", () => {
        const old = { type: "ul", props: {}, children: [{ type: "li", props: {}, children: [] }] };
        const li = { type: "li", props: {}, children: [] };
        expect(describePatch({ op: "REPLACE", path: [0], vnode: { type: "p", props: {}, children: [] } }, old)).toEqual(["REPLACE [0] <li> → <p>"]);
        expect(describePatch({ op: "CREATE", path: [1], vnode: li }, old)).toEqual(["CREATE [1] <li> 추가"]);
        expect(describePatch({ op: "REMOVE", path: [0] }, old)).toEqual(["REMOVE [0] <li> 삭제"]);
        expect([...changedKeys([{ op: "REMOVE", path: [0] }])]).toEqual([""]);
    });
});

describe("inspector 상세 보기", () => {
    test("HOOK_NAMES가 App의 훅 개수·종류와 맞는다", () => {
        withGame(({ c }) => {
            expect(c.hooks.length).toBe(HOOK_NAMES.length);
            const kinds = c.hooks.map(hookKind);
            expect(kinds).toEqual(["useState", "useState", "useState", "useState", "useMemo", "useMemo", "useEffect"]);
        });
    });

    test("카드를 뒤집으면 flipped 칸만 바뀌고 effect deps도 따라 바뀐다", () => {
        withGame(({ c, cards }) => {
            const first = hookRows(c.hooks, HOOK_NAMES);
            expect(first.every((r) => !r.changed)).toBe(true);
            cards()[2].click();
            const rows = hookRows(c.hooks, HOOK_NAMES, first);
            const changed = rows.filter((r) => r.changed).map((r) => `${r.name}:${r.from}→${r.text}`);
            expect(changed).toEqual(["flipped:[]→[" + createDeck(() => 0)[2].id + "]", "틀린 카드 되돌리기 effect:[[]]→[[" + createDeck(() => 0)[2].id + "]]"]);
        });
    });

    test("explainPath: 위치를 한글 경로로 풀어 쓴다", () => {
        const tree = { type: "div", props: {}, children: [{ type: "p", props: {}, children: ["a"] }, { type: "ul", props: { class: "x" }, children: [] }] };
        expect(explainPath(tree, [])).toBe("루트 <div>");
        expect(explainPath(tree, [1])).toBe('루트 <div> › 1번째 <ul class="x">');
        expect(explainPath(tree, [0, 0])).toBe('루트 <div> › 0번째 <p> › 0번째 "a"');
        expect(explainPath(tree, [5])).toBe("루트 <div> › 5번째 (없음)");
    });

    test("patchChanges: 이전 값과 새 값을 짝지어 주고 핸들러는 뺀다", () => {
        const old = { type: "b", props: { class: "a", title: "t" }, children: ["x"] };
        const props = patchChanges({ op: "PROPS", path: [], set: { class: "b", onClick: () => {} }, remove: ["title"] }, old);
        expect(props).toEqual([
            { label: "class", from: "a", to: "b" },
            { label: "title", from: "t", to: undefined },
        ]);
        expect(patchChanges({ op: "TEXT", path: [0], text: "y" }, old)).toEqual([{ label: "글자", from: "x", to: "y" }]);
    });

    test("formatValue: 객체 배열은 개수만, 긴 값은 줄인다", () => {
        expect(formatValue([{ id: 1 }, { id: 2 }])).toBe("배열 2개");
        expect(formatValue([1, 2])).toBe("[1,2]");
        expect(formatValue("x".repeat(100)).length).toBe(58);
    });
});
