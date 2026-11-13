// @vitest-environment jsdom
import { describe, test, expect } from "vitest";
import { FunctionComponent } from "../src/component/function_component.js";

const el = (type, props = {}, ...children) => ({ type, props, children });

describe("FunctionComponent", () => {
    test("mount: 올바른 DOM을 그리고 dom/oldVNode를 저장한다", () => {
        const container = document.createElement("div");
        const c = new FunctionComponent(({ name }) => el("div", { id: "root" }, el("h1", {}, `안녕 ${name}`)), { name: "리액트" });
        c.mount(container);
        expect(container.innerHTML).toBe('<div id="root"><h1>안녕 리액트</h1></div>');
        expect(c.dom).toBe(container.firstElementChild);
        expect(c.oldVNode.type).toBe("div");
        expect(c.hooks.length).toBe(0);
    });

    test("update: 바뀐 부분만 반영하고 나머지 요소는 같은 객체를 유지한다", () => {
        let count = 0;
        const container = document.createElement("div");
        const c = new FunctionComponent(() => el("div", {}, el("h1", {}, "제목"), el("p", {}, `count: ${count}`)));
        c.mount(container);
        const h1 = container.querySelector("h1");
        const root = c.dom;

        count = 1;
        c.update();

        expect(container.innerHTML).toBe("<div><h1>제목</h1><p>count: 1</p></div>");
        expect(container.querySelector("h1")).toBe(h1);
        expect(c.dom).toBe(root);
    });

    test("update 후 this.dom과 oldVNode가 갱신된다", () => {
        let label = "a";
        const container = document.createElement("div");
        const c = new FunctionComponent(() => el("p", {}, label));
        c.mount(container);
        const before = c.oldVNode;
        label = "b";
        c.update();
        expect(c.oldVNode).not.toBe(before);
        expect(c.oldVNode.children[0]).toBe("b");
        expect(c.dom).toBe(container.firstElementChild);
    });

    test("루트 태그 type이 바뀌어도 container 안의 DOM이 올바르다", () => {
        let tag = "p";
        const container = document.createElement("div");
        const c = new FunctionComponent(() => el(tag, {}, "x"));
        c.mount(container);
        tag = "section";
        c.update();
        expect(container.innerHTML).toBe("<section>x</section>");
        expect(c.dom).toBe(container.firstElementChild);
        tag = "article";
        c.update();
        expect(container.innerHTML).toBe("<article>x</article>");
    });

    test("render 는 호출 때마다 hookIndex를 0으로 되돌린다", () => {
        const c = new FunctionComponent(() => el("p"));
        c.hookIndex = 5;
        c.render();
        expect(c.hookIndex).toBe(0);
    });

    test("mount 전에 update 하면 에러", () => {
        const c = new FunctionComponent(() => el("p"));
        expect(() => c.update()).toThrow();
    });

    test("VNode가 아닌 반환값은 에러", () => {
        for (const bad of ["text", null, undefined, 3, [], {}, { type: "p" }]) {
            const c = new FunctionComponent(() => bad);
            expect(() => c.render()).toThrow();
            expect(() => c.mount(document.createElement("div"))).toThrow();
        }
    });
});
