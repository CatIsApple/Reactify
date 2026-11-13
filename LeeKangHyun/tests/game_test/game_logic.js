// 카드 게임 규칙 (DOM 비의존 순수 함수)
export const EMOJIS = ["🐶", "🐱", "🦊", "🐻", "🐼", "🐸", "🐵", "🦁"];

export function shuffle(list, random = Math.random) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// 이모지 8쌍 = 카드 16장, 섞인 순서
export function createDeck(random = Math.random) {
    return shuffle(
        EMOJIS.flatMap((emoji, i) => [
            { id: i * 2, emoji },
            { id: i * 2 + 1, emoji },
        ]),
        random
    );
}

// 두 장이 열려 있거나, 이미 열렸거나, 이미 맞춘 카드는 클릭을 무시한다
export function canFlip({ flipped, matched }, id) {
    return flipped.length < 2 && !flipped.includes(id) && !matched.includes(id);
}

export function isMatch(cards, aId, bId) {
    const a = cards.find((c) => c.id === aId);
    const b = cards.find((c) => c.id === bId);
    return Boolean(a && b && a.id !== b.id && a.emoji === b.emoji);
}
