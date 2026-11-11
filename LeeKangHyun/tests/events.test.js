// @vitest-environment jsdom
import { describe, test, expect } from "vitest";
import { vnodeToDom } from "../src/vdom/vdom_create.js";
import { patch } from "../src/patch/patch.js";
import { FunctionComponent } from "../src/component/function_component.js";
import { useState } from "../src/hooks/use_state.js";

const el = (type, props = {}, ...children) => ({ type, props, children });

function mount(vnode) {
    const container = document.createElement("div");
    const root = vnodeToDom(vnode);
    container.appendChild(root);
    return { container, root };
}

describe("이벤트 props", () => {
    test("vnodeToDom으로 만든 버튼 click이 핸들러를 호출한다", () => {
        let calls = 0;
        const { root } = mount(el("button", { onClick: () => calls++ }, "x"));
        root.click();
        expect(calls).toBe(1);
        expect(root.hasAttribute("onClick")).toBe(false);
    });

    test("patch로 핸들러를 바꾸면 옛 함수는 호출되지 않고 새 함수가 클릭당 한 번 호출된다", () => {
        const log = [];
        const { root } = mount(el("button", { onClick: () => log.push("old") }));
        for (let i = 0; i < 3; i++) {
            patch(root, [{ op: "PROPS", path: [], set: { onClick: () => log.push(`new${i}`) }, remove: [] }]);
        }
        root.click();
        expect(log).toEqual(["new2"]);
        root.click();
        expect(log).toEqual(["new2", "new2"]);
    });

    test("핸들러 prop을 제거하면 click해도 호출되지 않고, 다시 설정하면 한 번만 호출된다", () => {
        let calls = 0;
        const fn = () => calls++;
        const { root } = mount(el("button", { onClick: fn }));
        patch(root, [{ op: "PROPS", path: [], set: {}, remove: ["onClick"] }]);
        root.click();
        expect(calls).toBe(0);
        patch(root, [{ op: "PROPS", path: [], set: { onClick: fn }, remove: [] }]);
        root.click();
        expect(calls).toBe(1);
    });

    test("문자열 on* 속성(onclick=\"alert(1)\")은 무시된다", () => {
        const { root } = mount(el("button", { onclick: "alert(1)", onClick: "alert(2)" }));
        expect(root.hasAttribute("onclick")).toBe(false);
        expect(root.outerHTML).toBe("<button></button>");
        patch(root, [{ op: "PROPS", path: [], set: { onmouseover: "alert(3)" }, remove: [] }]);
        expect(root.hasAttribute("onmouseover")).toBe(false);
    });
});

describe("value / checked / boolean props", () => {
    test("value: 사용자가 값을 바꾼 뒤에도 patch로 바꾼 값(\"\" 포함)이 화면에 반영된다", () => {
        const { root } = mount(el("input", { value: "a" }));
        expect(root.value).toBe("a");
        root.value = "사용자 입력";
        patch(root, [{ op: "PROPS", path: [], set: { value: "b" }, remove: [] }]);
        expect(root.value).toBe("b");
        root.value = "또 입력";
        patch(root, [{ op: "PROPS", path: [], set: { value: "" }, remove: [] }]);
        expect(root.value).toBe("");
        root.value = "또또";
        patch(root, [{ op: "PROPS", path: [], set: {}, remove: ["value"] }]);
        expect(root.value).toBe("");
    });

    test("checked: 프로퍼티로 설정·해제된다", () => {
        const { root } = mount(el("input", { type: "checkbox", checked: true }));
        expect(root.checked).toBe(true);
        root.checked = false; // 사용자가 해제
        patch(root, [{ op: "PROPS", path: [], set: { checked: true }, remove: [] }]);
        expect(root.checked).toBe(true);
        patch(root, [{ op: "PROPS", path: [], set: {}, remove: ["checked"] }]);
        expect(root.checked).toBe(false);
    });

    test("disabled: false는 attribute가 없고 true는 있다", () => {
        const { root } = mount(el("button", { disabled: false }));
        expect(root.hasAttribute("disabled")).toBe(false);
        patch(root, [{ op: "PROPS", path: [], set: { disabled: true }, remove: [] }]);
        expect(root.getAttribute("disabled")).toBe("");
        patch(root, [{ op: "PROPS", path: [], set: { disabled: false }, remove: [] }]);
        expect(root.hasAttribute("disabled")).toBe(false);
    });

    test("일반 속성은 문자열로 변환해 setAttribute 한다", () => {
        const { root } = mount(el("div", { "data-n": 5, id: "a" }));
        expect(root.outerHTML).toBe('<div data-n="5" id="a"></div>');
    });
});

describe("통합: useState 카운터", () => {
    test("버튼 click N번이면 정확히 +N, 버튼 DOM은 같은 객체를 유지한다", () => {
        const container = document.createElement("div");
        new FunctionComponent(() => {
            const [n, setN] = useState(0);
            return el("div", {}, el("p", {}, `count: ${n}`), el("button", { onClick: () => setN((v) => v + 1) }, "+1"));
        }).mount(container);
        const button = container.querySelector("button");
        for (let i = 0; i < 5; i++) button.click();
        expect(container.querySelector("p").textContent).toBe("count: 5");
        expect(container.querySelector("button")).toBe(button);
    });
});
