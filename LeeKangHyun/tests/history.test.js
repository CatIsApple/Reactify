// @vitest-environment jsdom
import { describe, test, expect } from "vitest";
import { createHistory } from "../src/history/history.js";
import { diff } from "../src/diff/diff.js";
import { patch } from "../src/patch/patch.js";
import { vnodeToDom } from "../src/vdom/vdom_create.js";

const el = (type, props = {}, ...children) => ({ type, props, children });

describe("history", () => {
    test("초기값이 첫 상태이고 이동할 수 없다", () => {
        const h = createHistory("v0");
        expect(h.current()).toBe("v0");
        expect(h.canBack()).toBe(false);
        expect(h.canForward()).toBe(false);
    });

    test("push 하면 현재가 새 상태가 된다", () => {
        const h = createHistory("v0");
        h.push("v1");
        expect(h.current()).toBe("v1");
        expect(h.canBack()).toBe(true);
        expect(h.canForward()).toBe(false);
    });

    test("back / forward 는 한 칸씩 이동하고 vnode를 반환한다", () => {
        const h = createHistory("v0");
        h.push("v1");
        h.push("v2");
        expect(h.back()).toBe("v1");
        expect(h.back()).toBe("v0");
        expect(h.forward()).toBe("v1");
        expect(h.current()).toBe("v1");
    });

    test("처음에서 back, 끝에서 forward 는 null이고 위치가 바뀌지 않는다", () => {
        const h = createHistory("v0");
        expect(h.back()).toBe(null);
        h.push("v1");
        expect(h.forward()).toBe(null);
        expect(h.current()).toBe("v1");
    });

    test("back 후 push 하면 앞으로가기 기록이 사라진다", () => {
        const h = createHistory("v0");
        h.push("v1");
        h.push("v2");
        h.back();
        h.push("v3");
        expect(h.current()).toBe("v3");
        expect(h.canForward()).toBe(false);
        expect(h.back()).toBe("v1");
        expect(h.back()).toBe("v0");
    });

    test("vnode를 복사하지 않고 같은 참조를 돌려준다", () => {
        const v1 = el("p");
        const h = createHistory(el("div"));
        h.push(v1);
        expect(h.current()).toBe(v1);
    });
});

describe("history 이동 + diff/patch", () => {
    test("이동할 때마다 실제 DOM이 target으로 만든 DOM과 같다", () => {
        const states = [
            el("div", { id: "a" }, el("p", {}, "0")),
            el("div", { id: "b" }, el("p", {}, "1"), el("p", {}, "extra")),
            el("section", {}, "root changed"),
        ];
        const container = document.createElement("div");
        container.appendChild(vnodeToDom(states[2]));
        const h = createHistory(states[0]);
        states.slice(1).forEach((s) => h.push(s));

        let current = states[2];
        const goTo = (target) => {
            patch(container.firstElementChild, diff(current, target));
            current = target;
            return container.firstElementChild.outerHTML;
        };
        // 마지막 상태에서 뒤로 두 번, 앞으로 두 번
        for (const target of [h.back(), h.back(), h.forward(), h.forward()]) {
            expect(goTo(target)).toBe(vnodeToDom(target).outerHTML);
        }
    });
});
