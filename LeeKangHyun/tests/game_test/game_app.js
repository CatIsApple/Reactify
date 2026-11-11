import { useState } from "../../src/hooks/use_state.js";
import { useEffect } from "../../src/hooks/use_effect.js";
import { useMemo } from "../../src/hooks/use_memo.js";
import { createDeck, canFlip, isMatch } from "./game_logic.js";

const h = (type, props = {}, ...children) => ({ type, props, children: children.flat().filter((c) => c != null && c !== false) });

// ---- 자식 컴포넌트: props만 받는 순수 함수 ----

export function Card({ card, open, matched, onFlip }) {
    const cls = matched ? "card matched" : open ? "card flipped" : "card";
    return h("button", { class: cls, onClick: () => onFlip(card.id) }, open || matched ? card.emoji : "?");
}

export function Board({ cards, flipped, matched, onFlip }) {
    return h(
        "div",
        { class: "board" },
        cards.map((card) => Card({ card, open: flipped.includes(card.id), matched: matched.includes(card.id), onFlip }))
    );
}

export function Stats({ moves, pairs, total }) {
    return h("p", { class: "stats" }, `시도 ${moves}번 · 맞춘 쌍 ${pairs}/${total}`);
}

// 항상 같은 자리에 두고 글자만 바꿔 자식 인덱스가 밀리지 않게 한다
export function Message({ won, moves }) {
    return h("p", { class: "message" }, won ? `🎉 모두 맞췄어요! ${moves}번 만에 성공` : "");
}

export function Controls({ onRestart }) {
    return h("div", { class: "controls" }, h("button", { onClick: onRestart }, "다시 시작"));
}

// ---- 루트 컴포넌트: 모든 State와 Hook은 여기서만 쓴다 ----

export function App() {
    const [round, setRound] = useState(0);
    const [flipped, setFlipped] = useState([]);
    const [matched, setMatched] = useState([]);
    const [moves, setMoves] = useState(0);

    const cards = useMemo(() => createDeck(), [round]);
    const pairs = useMemo(() => matched.length / 2, [matched]);
    const won = pairs === cards.length / 2;

    // 두 장이 다르면 800ms 뒤 다시 뒤집는다. 맞췄다면 flipped가 먼저 비워져 cleanup이 타이머를 취소한다
    useEffect(() => {
        if (flipped.length !== 2) return;
        const id = setTimeout(() => setFlipped([]), 800);
        return () => clearTimeout(id);
    }, [flipped]);

    const flip = (id) => {
        if (!canFlip({ flipped, matched }, id)) return;
        const next = [...flipped, id];
        setFlipped(next);
        if (next.length < 2) return;
        setMoves(moves + 1);
        if (isMatch(cards, next[0], next[1])) {
            setMatched([...matched, ...next]);
            setFlipped([]);
        }
    };
    const restart = () => {
        setFlipped([]);
        setMatched([]);
        setMoves(0);
        setRound(round + 1);
    };

    return h(
        "div",
        { class: "game" },
        Stats({ moves, pairs, total: cards.length / 2 }),
        Board({ cards, flipped, matched, onFlip: flip }),
        Message({ won, moves }),
        Controls({ onRestart: restart })
    );
}

// App 안에서 훅을 호출하는 순서와 같아야 한다 (패널이 hooks 배열의 칸에 이름을 붙이는 데 쓴다)
export const HOOK_NAMES = ["round", "flipped", "matched", "moves", "cards", "pairs", "틀린 카드 되돌리기 effect"];
