import { useState } from "../hooks/use_state.js";
import { useEffect } from "../hooks/use_effect.js";
import { useMemo } from "../hooks/use_memo.js";

// VNode 생성 도우미: 자식 배열을 펼치고 null/false는 버린다
const h = (type, props = {}, ...children) => ({ type, props, children: children.flat().filter((c) => c != null && c !== false) });

// ---- 자식 컴포넌트: 상태·훅 없이 props만 받는 순수 함수 (필요한 값과 콜백은 App이 내려준다) ----

export function Header({ seconds }) {
    return h("header", {}, h("h1", {}, "할 일 목록"), h("p", { class: "clock" }, `실행 시간: ${seconds}초`));
}

export function TodoForm({ text, onInput, onAdd, onKeyDown }) {
    // 입력창은 항상 같은 자리(첫 번째 자식)에 둔다
    return h(
        "div",
        { class: "form" },
        h("input", { type: "text", placeholder: "할 일을 입력하세요", value: text, onInput, onKeyDown }),
        h("button", { onClick: onAdd }, "추가")
    );
}

const FILTERS = [
    ["all", "전체"],
    ["active", "진행중"],
    ["done", "완료"],
];

export function Filters({ filter, onChange }) {
    return h(
        "div",
        { class: "filters" },
        FILTERS.map(([value, label]) => h("button", { class: filter === value ? "active" : undefined, onClick: () => onChange(value) }, label))
    );
}

export function TodoItem({ todo, onToggle, onDelete }) {
    return h(
        "li",
        { class: todo.done ? "done" : undefined },
        h("input", { type: "checkbox", checked: todo.done, onChange: onToggle }),
        h("span", {}, todo.text),
        h("button", { onClick: onDelete }, "삭제")
    );
}

export function TodoList({ items, onToggle, onDelete }) {
    if (items.length === 0) return h("p", { class: "empty" }, "할 일이 없습니다. 위에서 추가해 보세요.");
    return h(
        "ul",
        {},
        items.map((todo) => TodoItem({ todo, onToggle: () => onToggle(todo.id), onDelete: () => onDelete(todo.id) }))
    );
}

export function Stats({ remaining, total }) {
    return h("p", { class: "stats" }, `남은 할 일 ${remaining}개 / 전체 ${total}개`);
}

// ---- 루트 컴포넌트: 모든 State와 Hook은 여기서만 쓴다 ----

export function App() { //역할 : 상태를 저장하고, 상태를 바꾸는 함수를 반환한다. (React의 useState와 동일)
    const [todos, setTodos] = useState([]);
    const [text, setText] = useState("");
    const [filter, setFilter] = useState("all");
    const [nextId, setNextId] = useState(1);
    const [seconds, setSeconds] = useState(0);

    const remaining = useMemo(() => todos.filter((t) => !t.done).length, [todos]);
    const visible = useMemo(
        () => todos.filter((t) => (filter === "all" ? true : filter === "active" ? !t.done : t.done)),
        [todos, filter]
    );

    useEffect(() => {
        document.title = `남은 할 일 ${remaining}`;
    }, [todos]);

    // cleanup 예시: deps []라 mount 때 한 번 시작하고 unmount 때 정리한다
    useEffect(() => {
        const id = setInterval(() => setSeconds((s) => s + 1), 1000);
        return () => clearInterval(id);
    }, []);

    const add = () => {
        const value = text.trim();
        if (!value) return;
        setTodos([...todos, { id: nextId, text: value, done: false }]);
        setNextId(nextId + 1);
        setText("");
    };
    const toggle = (id) => setTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    const remove = (id) => setTodos(todos.filter((t) => t.id !== id));

    return h(
        "div",
        { class: "app" },
        Header({ seconds }),
        TodoForm({
            text,
            onInput: (e) => setText(e.target.value),
            onAdd: add,
            onKeyDown: (e) => {
                if (e.key === "Enter") add();
            },
        }),
        Filters({ filter, onChange: setFilter }),
        TodoList({ items: visible, onToggle: toggle, onDelete: remove }),
        Stats({ remaining, total: todos.length })
    );
}
