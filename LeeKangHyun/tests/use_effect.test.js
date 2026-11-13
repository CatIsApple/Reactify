// @vitest-environment jsdom
import { describe, test, expect } from "vitest";
import { FunctionComponent } from "../src/component/function_component.js";
import { useState } from "../src/hooks/use_state.js";
import { useEffect } from "../src/hooks/use_effect.js";

const el = (type, props = {}, ...children) => ({ type, props, children });

describe("useEffect", () => {
    test("mount 후 실행되고, effect 안에서 DOM이 이미 그려져 있다", () => {
        const container = document.createElement("div");
        let seen = null;
        new FunctionComponent(() => {
            useEffect(() => {
                seen = container.querySelector("p")?.textContent;
            }, []);
            return el("div", {}, el("p", {}, "hello"));
        }).mount(container);
        expect(seen).toBe("hello");
    });

    test("렌더 중에는 실행하지 않고 예약만 한다", () => {
        const log = [];
        const c = new FunctionComponent(() => {
            useEffect(() => log.push("effect"), []);
            log.push("render");
            return el("p");
        });
        c.render();
        expect(log).toEqual(["render"]);
        expect(c.pendingEffects.length).toBe(1);
    });

    test("deps []는 update를 여러 번 해도 한 번만 실행된다", () => {
        let runs = 0;
        const c = new FunctionComponent(() => {
            useEffect(() => void runs++, []);
            return el("p");
        });
        c.mount(document.createElement("div"));
        c.update();
        c.update();
        expect(runs).toBe(1);
    });

    test("deps 배열은 값이 바뀔 때만 다시 실행하고 같으면 건너뛴다", () => {
        let dep = 1;
        let runs = 0;
        const c = new FunctionComponent(() => {
            useEffect(() => void runs++, [dep]);
            return el("p");
        });
        c.mount(document.createElement("div"));
        c.update();
        expect(runs).toBe(1);
        dep = 2;
        c.update();
        expect(runs).toBe(2);
        c.update();
        expect(runs).toBe(2);
    });

    test("deps가 없으면 매 렌더 후 실행된다", () => {
        let runs = 0;
        const c = new FunctionComponent(() => {
            useEffect(() => void runs++);
            return el("p");
        });
        c.mount(document.createElement("div"));
        c.update();
        c.update();
        expect(runs).toBe(3);
    });

    test("cleanup은 다음 effect 실행 전에 호출된다", () => {
        const log = [];
        let n = 0;
        const c = new FunctionComponent(() => {
            const v = n;
            useEffect(() => {
                log.push(`effect ${v}`);
                return () => log.push(`cleanup ${v}`);
            }, [v]);
            return el("p");
        });
        c.mount(document.createElement("div"));
        n = 1;
        c.update();
        n = 2;
        c.update();
        expect(log).toEqual(["effect 0", "cleanup 0", "effect 1", "cleanup 1", "effect 2"]);
    });

    test("update 후 effect 안에서 갱신된 DOM이 보인다", () => {
        const container = document.createElement("div");
        let text = "a";
        const seen = [];
        const c = new FunctionComponent(() => {
            const t = text;
            useEffect(() => void seen.push(container.querySelector("p").textContent), [t]);
            return el("p", {}, t);
        });
        c.mount(container);
        text = "b";
        c.update();
        expect(seen).toEqual(["a", "b"]);
    });

    test("effect 안의 setState가 재렌더를 일으킨다", () => {
        const container = document.createElement("div");
        new FunctionComponent(() => {
            const [n, setN] = useState(0);
            useEffect(() => {
                setN(5);
            }, []);
            return el("p", {}, `n: ${n}`);
        }).mount(container);
        expect(container.textContent).toBe("n: 5");
    });

    test("unmount는 cleanup을 호출하고 DOM을 제거하며 이후 update는 에러", () => {
        const container = document.createElement("div");
        const log = [];
        const c = new FunctionComponent(() => {
            useEffect(() => () => log.push("cleanup"), []);
            return el("p", {}, "x");
        });
        c.mount(container);
        c.unmount();
        expect(log).toEqual(["cleanup"]);
        expect(container.innerHTML).toBe("");
        expect(() => c.update()).toThrow();
    });

    test("렌더 밖 호출과 함수가 아닌 effect는 에러", () => {
        expect(() => useEffect(() => {}, [])).toThrow();
        const c = new FunctionComponent(() => {
            useEffect("not a function", []);
            return el("p");
        });
        expect(() => c.render()).toThrow();
    });
});
