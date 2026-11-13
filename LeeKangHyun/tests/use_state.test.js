// @vitest-environment jsdom
import { describe, test, expect } from "vitest";
import { FunctionComponent } from "../src/component/function_component.js";
import { useState } from "../src/hooks/use_state.js";

const el = (type, props = {}, ...children) => ({ type, props, children });

// vnodeToDom은 이벤트 props를 다루지 않으므로, 테스트에서 버튼에 직접 click 리스너를 붙인다
function mountCounter() {
    const container = document.createElement("div");
    let setCount;
    let renders = 0;
    const c = new FunctionComponent(() => {
        renders++;
        const [count, set] = useState(0);
        setCount = set;
        return el("div", {}, el("h1", {}, "제목"), el("p", {}, `count: ${count}`), el("button", {}, "+1"));
    });
    c.mount(container);
    container.querySelector("button").addEventListener("click", () => setCount((n) => n + 1));
    return { container, c, getSet: () => setCount, getRenders: () => renders };
}

describe("useState", () => {
    test("초기값을 반환한다", () => {
        let got;
        new FunctionComponent(() => {
            got = useState(7);
            return el("p");
        }).mount(document.createElement("div"));
        expect(got[0]).toBe(7);
        expect(typeof got[1]).toBe("function");
    });

    test("click -> setState -> 바뀐 부분만 patch, 나머지 요소는 === 유지", () => {
        const { container } = mountCounter();
        const h1 = container.querySelector("h1");
        const button = container.querySelector("button");
        button.click();
        expect(container.querySelector("p").textContent).toBe("count: 1");
        expect(container.querySelector("h1")).toBe(h1);
        expect(container.querySelector("button")).toBe(button);
    });

    test("여러 번 setState해도 상태가 유지된다 (+1 세 번 = 3)", () => {
        const { container } = mountCounter();
        const button = container.querySelector("button");
        button.click();
        button.click();
        button.click();
        expect(container.querySelector("p").textContent).toBe("count: 3");
    });

    test("같은 값이면 fn이 다시 실행되지 않는다", () => {
        const { getSet, getRenders } = mountCounter();
        expect(getRenders()).toBe(1);
        getSet()(0);
        expect(getRenders()).toBe(1);
        getSet()(1);
        expect(getRenders()).toBe(2);
        getSet()(1);
        expect(getRenders()).toBe(2);
    });

    test("함수형 업데이트 setState(prev => prev + 1)", () => {
        const { container, getSet } = mountCounter();
        getSet()((prev) => prev + 10);
        expect(container.querySelector("p").textContent).toBe("count: 10");
    });

    test("useState 두 개는 서로 독립적이다", () => {
        const container = document.createElement("div");
        let setA, setB;
        new FunctionComponent(() => {
            const [a, sa] = useState(1);
            const [b, sb] = useState("x");
            setA = sa;
            setB = sb;
            return el("p", {}, `${a}${b}`);
        }).mount(container);
        expect(container.textContent).toBe("1x");
        setA(2);
        expect(container.textContent).toBe("2x");
        setB("y");
        expect(container.textContent).toBe("2y");
    });

    test("setState 함수는 렌더 간 같은 함수(===)다", () => {
        const container = document.createElement("div");
        const setters = [];
        new FunctionComponent(() => {
            const [n, set] = useState(0);
            setters.push(set);
            return el("p", {}, String(n));
        }).mount(container);
        setters[0](1);
        setters[0](2);
        expect(setters.length).toBe(3);
        expect(setters[1]).toBe(setters[0]);
        expect(setters[2]).toBe(setters[0]);
    });

    test("렌더 밖에서 useState를 호출하면 에러", () => {
        expect(() => useState(0)).toThrow();
    });

    test("렌더 도중 setState를 호출하면 에러", () => {
        const c = new FunctionComponent(() => {
            const [n, set] = useState(0);
            set(n + 1);
            return el("p");
        });
        expect(() => c.mount(document.createElement("div"))).toThrow();
    });

    test("렌더가 예외로 끝나도 현재 컴포넌트가 복원된다", () => {
        const bad = new FunctionComponent(() => {
            throw new Error("boom");
        });
        expect(() => bad.render()).toThrow();
        expect(() => useState(0)).toThrow();
    });
});
