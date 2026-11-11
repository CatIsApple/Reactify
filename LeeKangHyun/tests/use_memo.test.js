// @vitest-environment jsdom
import { describe, test, expect } from "vitest";
import { FunctionComponent } from "../src/component/function_component.js";
import { useState } from "../src/hooks/use_state.js";
import { useEffect } from "../src/hooks/use_effect.js";
import { useMemo } from "../src/hooks/use_memo.js";

const el = (type, props = {}, ...children) => ({ type, props, children });

describe("useMemo", () => {
    test("첫 렌더에 factory를 실행하고 값을 반환한다", () => {
        let got;
        let calls = 0;
        new FunctionComponent(() => {
            got = useMemo(() => (calls++, 42), []);
            return el("p");
        }).mount(document.createElement("div"));
        expect(got).toBe(42);
        expect(calls).toBe(1);
    });

    test("deps가 같으면 update해도 factory가 다시 실행되지 않는다", () => {
        let calls = 0;
        const c = new FunctionComponent(() => {
            useMemo(() => void calls++, [1, "a"]);
            return el("p");
        });
        c.mount(document.createElement("div"));
        c.update();
        c.update();
        expect(calls).toBe(1);
    });

    test("deps 값이 바뀌면 재계산한다", () => {
        let dep = 1;
        let got;
        const c = new FunctionComponent(() => {
            got = useMemo(() => dep * 10, [dep]);
            return el("p");
        });
        c.mount(document.createElement("div"));
        expect(got).toBe(10);
        dep = 2;
        c.update();
        expect(got).toBe(20);
    });

    test("deps []는 한 번만 계산한다", () => {
        let calls = 0;
        const c = new FunctionComponent(() => {
            useMemo(() => void calls++, []);
            return el("p");
        });
        c.mount(document.createElement("div"));
        c.update();
        expect(calls).toBe(1);
    });

    test("deps가 없으면 매 렌더 재계산한다", () => {
        let calls = 0;
        const c = new FunctionComponent(() => {
            useMemo(() => void calls++);
            return el("p");
        });
        c.mount(document.createElement("div"));
        c.update();
        c.update();
        expect(calls).toBe(3);
    });

    test("객체를 반환하면 deps가 같을 때 같은 참조(===)다", () => {
        const seen = [];
        let dep = 1;
        const c = new FunctionComponent(() => {
            seen.push(useMemo(() => ({ v: dep }), [dep]));
            return el("p");
        });
        c.mount(document.createElement("div"));
        c.update();
        dep = 2;
        c.update();
        expect(seen[1]).toBe(seen[0]);
        expect(seen[2] === seen[0]).toBe(false);
    });

    test("useState/useEffect와 섞어 써도 hookIndex 순서가 맞는다", () => {
        const container = document.createElement("div");
        const log = [];
        let setN;
        new FunctionComponent(() => {
            const [n, set] = useState(1);
            setN = set;
            const doubled = useMemo(() => n * 2, [n]);
            useEffect(() => void log.push(doubled), [doubled]);
            const [label] = useState("L");
            return el("p", {}, `${n}:${doubled}:${label}`);
        }).mount(container);
        expect(container.textContent).toBe("1:2:L");
        setN(5);
        expect(container.textContent).toBe("5:10:L");
        expect(log).toEqual([2, 10]);
    });

    test("렌더 밖 호출과 함수가 아닌 factory는 에러", () => {
        expect(() => useMemo(() => 1, [])).toThrow();
        const c = new FunctionComponent(() => {
            useMemo(123, []);
            return el("p");
        });
        expect(() => c.render()).toThrow();
    });

    test("factory가 예외를 던지면 캐시하지 않고 다음 렌더에 다시 시도한다", () => {
        let calls = 0;
        let got;
        const c = new FunctionComponent(() => {
            got = useMemo(() => {
                calls++;
                if (calls === 1) throw new Error("boom");
                return "ok";
            }, []);
            return el("p");
        });
        expect(() => c.mount(document.createElement("div"))).toThrow("boom");
        c.render();
        expect(calls).toBe(2);
        expect(got).toBe("ok");
    });
});
