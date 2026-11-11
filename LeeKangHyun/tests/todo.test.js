// @vitest-environment jsdom
import { describe, test, expect } from "vitest";
import { FunctionComponent } from "../src/component/function_component.js";
import { App, TodoItem, Header, TodoForm, Filters, TodoList, Stats } from "../src/app/todo_app.js";

// 실제 타이머 대신 콜백을 붙잡아 두고 테스트가 직접 "1초 경과"를 일으킨다
const intervals = new Map();
let nextTimer = 1;
globalThis.setInterval = (fn) => {
    const id = nextTimer++;
    intervals.set(id, fn);
    return id;
};
globalThis.clearInterval = (id) => void intervals.delete(id);

function mountApp() {
    intervals.clear();
    const container = document.createElement("div");
    document.body.replaceChildren(container); // 체크박스 change 이벤트는 문서에 연결된 요소에서만 발생한다
    const c = new FunctionComponent(App);
    c.mount(container);
    return { container, c };
}
const input = (container) => container.querySelector('input[type="text"]');
const button = (container, label) => [...container.querySelectorAll("button")].find((b) => b.textContent === label);
const type = (container, value) => {
    const el = input(container);
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
};
const add = (container, value) => {
    type(container, value);
    button(container, "추가").click();
};
const items = (container) => [...container.querySelectorAll("li")];

describe("Todo 앱", () => {
    test("초기 렌더: 안내 문구, 남은 개수, 제목 갱신", () => {
        const { container } = mountApp();
        expect(container.querySelector("h1").textContent).toBe("할 일 목록");
        expect(container.querySelector(".empty").textContent).toContain("할 일이 없습니다");
        expect(container.querySelector(".stats").textContent).toBe("남은 할 일 0개 / 전체 0개");
        expect(document.title).toBe("남은 할 일 0");
    });

    test("입력 후 추가 버튼과 Enter로 항목이 추가되고 입력창이 비워진다", () => {
        const { container } = mountApp();
        add(container, "  우유 사기  ");
        expect(items(container).map((li) => li.querySelector("span").textContent)).toEqual(["우유 사기"]);
        expect(input(container).value).toBe("");

        type(container, "빨래");
        input(container).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(items(container).length).toBe(2);
        expect(input(container).value).toBe("");
        expect(container.querySelector(".empty")).toBe(null);
    });

    test("공백뿐이거나 빈 입력은 추가되지 않는다", () => {
        const { container } = mountApp();
        add(container, "   ");
        add(container, "");
        expect(items(container).length).toBe(0);
        expect(container.querySelector(".empty")).not.toBe(null);
    });

    test("체크박스 토글 시 남은 개수와 document.title이 갱신된다", () => {
        const { container } = mountApp();
        add(container, "a");
        add(container, "b");
        expect(document.title).toBe("남은 할 일 2");
        items(container)[0].querySelector('input[type="checkbox"]').click();
        expect(container.querySelector(".stats").textContent).toBe("남은 할 일 1개 / 전체 2개");
        expect(document.title).toBe("남은 할 일 1");
        expect(items(container)[0].className).toBe("done");
        items(container)[0].querySelector('input[type="checkbox"]').click();
        expect(document.title).toBe("남은 할 일 2");
        expect(items(container)[0].hasAttribute("class")).toBe(false);
    });

    test("삭제", () => {
        const { container } = mountApp();
        add(container, "a");
        add(container, "b");
        items(container)[0].querySelector("button").click();
        expect(items(container).map((li) => li.querySelector("span").textContent)).toEqual(["b"]);
        items(container)[0].querySelector("button").click();
        expect(items(container).length).toBe(0);
        expect(container.querySelector(".empty")).not.toBe(null);
    });

    test("필터 전환 시 목록과 강조가 갱신된다", () => {
        const { container } = mountApp();
        add(container, "a");
        add(container, "b");
        add(container, "c");
        items(container)[1].querySelector('input[type="checkbox"]').click();
        const texts = () => items(container).map((li) => li.querySelector("span").textContent);

        button(container, "진행중").click();
        expect(texts()).toEqual(["a", "c"]);
        expect(button(container, "진행중").className).toBe("active");
        expect(button(container, "전체").hasAttribute("class")).toBe(false);

        button(container, "완료").click();
        expect(texts()).toEqual(["b"]);
        expect(button(container, "완료").className).toBe("active");

        button(container, "전체").click();
        expect(texts()).toEqual(["a", "b", "c"]);
    });

    test("부분 업데이트: 항목을 추가해도 기존 DOM 요소와 입력창이 유지된다", () => {
        const { container } = mountApp();
        add(container, "a");
        const first = items(container)[0];
        const box = input(container);
        const checkbox = first.querySelector('input[type="checkbox"]');
        type(container, "입력 중");
        expect(input(container)).toBe(box);
        add(container, "b");
        expect(items(container)[0]).toBe(first);
        expect(first.querySelector('input[type="checkbox"]')).toBe(checkbox);
        expect(input(container)).toBe(box);
    });

    test("자식 컴포넌트는 렌더 밖에서 직접 호출해도 VNode를 반환한다 (훅을 쓰지 않음)", () => {
        const noop = () => {};
        const todo = { id: 1, text: "x", done: false };
        const results = [
            TodoItem({ todo, onToggle: noop, onDelete: noop }),
            Header({ seconds: 3 }),
            TodoForm({ text: "", onInput: noop, onAdd: noop, onKeyDown: noop }),
            Filters({ filter: "all", onChange: noop }),
            TodoList({ items: [todo], onToggle: noop, onDelete: noop }),
            TodoList({ items: [], onToggle: noop, onDelete: noop }),
            Stats({ remaining: 1, total: 1 }),
        ];
        for (const vnode of results) {
            expect(typeof vnode.type).toBe("string");
            expect(Array.isArray(vnode.children)).toBe(true);
        }
    });

    test("시계 effect: 1초마다 갱신되고 unmount 하면 interval이 정리된다", () => {
        const { container, c } = mountApp();
        expect(container.querySelector(".clock").textContent).toBe("실행 시간: 0초");
        expect(intervals.size).toBe(1);
        const tick = [...intervals.values()][0];
        tick();
        tick();
        expect(container.querySelector(".clock").textContent).toBe("실행 시간: 2초");
        c.unmount();
        expect(intervals.size).toBe(0);
    });
});
