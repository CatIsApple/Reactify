// @vitest-environment jsdom
import { describe, test, expect } from "vitest";
import { diff } from "../src/diff/diff.js";
import { patch } from "../src/patch/patch.js";
import { vnodeToDom } from "../src/vdom/vdom_create.js";

const el = (type, props = {}, ...children) => ({ type, props, children });

// 루트 교체(replaceWith)를 위해 부모 컨테이너 안에 마운트한다
function mount(vnode) {
    const container = document.createElement("div");
    const root = vnodeToDom(vnode);
    container.appendChild(root);
    return { container, root };
}

describe("patch 5가지 op", () => {
    test("TEXT: 텍스트 노드 내용을 바꾼다", () => {
        const { root } = mount(el("p", {}, "a"));
        patch(root, [{ op: "TEXT", path: [0], text: "b" }]);
        expect(root.outerHTML).toBe("<p>b</p>");
    });

    test("PROPS: set은 추가·변경, remove는 삭제", () => {
        const { root } = mount(el("div", { id: "a", title: "t" }));
        patch(root, [{ op: "PROPS", path: [], set: { id: "b", lang: "ko" }, remove: ["title"] }]);
        expect(root.outerHTML).toBe('<div id="b" lang="ko"></div>');
    });

    test("CREATE: 부모 끝에 추가한다", () => {
        const { root } = mount(el("ul", {}, el("li", {}, "1")));
        patch(root, [{ op: "CREATE", path: [1], vnode: el("li", {}, "2") }]);
        expect(root.outerHTML).toBe("<ul><li>1</li><li>2</li></ul>");
    });

    test("REMOVE: 대상 노드를 제거한다", () => {
        const { root } = mount(el("ul", {}, el("li", {}, "1"), el("li", {}, "2")));
        patch(root, [{ op: "REMOVE", path: [1] }]);
        expect(root.outerHTML).toBe("<ul><li>1</li></ul>");
    });

    test("REPLACE: 자식 노드를 교체한다", () => {
        const { root } = mount(el("div", {}, el("p", {}, "a")));
        patch(root, [{ op: "REPLACE", path: [0], vnode: el("span", {}, "b") }]);
        expect(root.outerHTML).toBe("<div><span>b</span></div>");
    });

    test("REPLACE: 루트가 바뀌면 새 루트를 반환하고 DOM에 반영된다", () => {
        const { container, root } = mount(el("p", {}, "a"));
        const next = patch(root, [{ op: "REPLACE", path: [], vnode: el("h1", {}, "b") }]);
        expect(next === root).toBe(false);
        expect(container.firstChild).toBe(next);
        expect(next.outerHTML).toBe("<h1>b</h1>");
    });

    test("중첩 구조: 깊은 path를 따라간다", () => {
        const { root } = mount(el("div", {}, el("ul", {}, el("li", {}, "a"), el("li", {}, "b"))));
        patch(root, [{ op: "TEXT", path: [0, 1, 0], text: "c" }]);
        expect(root.outerHTML).toBe("<div><ul><li>a</li><li>c</li></ul></div>");
    });
});

describe("patch 오류", () => {
    test("path에 노드가 없으면 에러를 던진다", () => {
        const { root } = mount(el("p", {}, "a"));
        expect(() => patch(root, [{ op: "TEXT", path: [3], text: "x" }])).toThrow();
    });

    test("CREATE 위치가 DOM과 맞지 않으면 에러를 던진다", () => {
        const { root } = mount(el("ul"));
        expect(() => patch(root, [{ op: "CREATE", path: [2], vnode: "x" }])).toThrow();
    });
});

describe("diff -> patch 왕복", () => {
    const cases = [
        ["텍스트·속성 변경", el("div", { id: "a" }, el("p", {}, "x")), el("div", { id: "b" }, el("p", {}, "y"))],
        ["자식 추가", el("ul", {}, el("li", {}, "1")), el("ul", {}, el("li", {}, "1"), el("li", {}, "2"), el("li", {}, "3"))],
        ["자식 여러 개 삭제", el("ul", {}, el("li"), el("li"), el("li")), el("ul", {}, el("li"))],
        ["텍스트와 요소 혼합", el("p", {}, "가격: ", el("b", {}, "100"), "원"), el("p", {}, "가격: ", el("i", {}, "200"), "원")],
        ["루트 type 변경", el("p", {}, "a"), el("div", { class: "c" }, "b")],
    ];
    for (const [name, oldV, newV] of cases) {
        test(`${name}: patch 결과가 새 VNode로 만든 DOM과 같다`, () => {
            const { root } = mount(oldV);
            const next = patch(root, diff(oldV, newV));
            expect(next.outerHTML).toBe(vnodeToDom(newV).outerHTML);
        });
    }

    test("바뀌지 않은 노드는 같은 객체로 남는다", () => {
        const oldV = el("div", {}, el("p", {}, "a"), el("span", {}, "b"));
        const newV = el("div", {}, el("p", {}, "a"), el("span", {}, "c"));
        const { root } = mount(oldV);
        const p = root.firstChild;
        patch(root, diff(oldV, newV));
        expect(root.firstChild).toBe(p);
    });
});
