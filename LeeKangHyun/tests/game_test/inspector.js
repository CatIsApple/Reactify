// diff 결과를 사람이 읽기 쉽게 바꾸는 순수 함수 모음 (DOM 비의존)
const key = (path) => path.join(",");
const fmt = (path) => `[${path.join(",")}]`;

export function getNode(root, path) {
    let node = root;
    for (const i of path) {
        if (node === undefined || typeof node === "string") return undefined;
        node = node.children[i];
    }
    return node;
}

export function countNodes(vnode) {
    return typeof vnode === "string" ? 1 : 1 + vnode.children.reduce((sum, c) => sum + countNodes(c), 0);
}

// 이벤트 핸들러는 렌더마다 새 함수라 매번 PROPS가 생긴다. 학습용 표시에서는 이것만 바뀐 패치를 제외한다
export const isHandlerOnly = (p) => p.op === "PROPS" && p.remove.length === 0 && Object.values(p.set).every((v) => typeof v === "function");
export const meaningfulPatches = (patches) => patches.filter((p) => !isHandlerOnly(p));

const label = (v) => (v === undefined ? "(없음)" : typeof v === "string" ? `"${v}"` : `<${v.type}${v.props.class ? ` class="${v.props.class}"` : ""}>`);

// 패치 하나를 문장(들)로 바꾼다. oldRoot는 바뀌기 전 VNode (이전 값을 보여 주기 위해)
export function describePatch(p, oldRoot) {
    const where = fmt(p.path);
    const old = getNode(oldRoot, p.path);
    switch (p.op) {
        case "TEXT":
            return [`TEXT ${where} ${old} → ${p.text}`];
        case "PROPS": {
            const lines = [];
            for (const [k, v] of Object.entries(p.set)) {
                if (typeof v !== "function") lines.push(`PROPS ${where} ${k}: ${old?.props?.[k] ?? "(없음)"} → ${v}`);
            }
            for (const k of p.remove) lines.push(`PROPS ${where} ${k} 삭제 (${old?.props?.[k]})`);
            return lines;
        }
        case "REPLACE":
            return [`REPLACE ${where} ${label(old)} → ${label(p.vnode)}`];
        case "CREATE":
            return [`CREATE ${where} ${label(p.vnode)} 추가`];
        case "REMOVE":
            return [`REMOVE ${where} ${label(old)} 삭제`];
        default:
            return [`${p.op} ${where}`];
    }
}

// 바뀐 노드의 경로 집합. REMOVE는 사라진 노드를 가리킬 수 없으니 부모를 표시한다
export function changedKeys(patches) {
    return new Set(meaningfulPatches(patches).map((p) => key(p.op === "REMOVE" ? p.path.slice(0, -1) : p.path)));
}

// 현재 VNode 트리를 들여쓰기 텍스트 줄 목록으로 만든다. changed에 든 경로는 changed: true
export function treeLines(vnode, changed = new Set(), path = [], depth = 0) {
    const pad = "  ".repeat(depth);
    const isChanged = changed.has(key(path));
    if (typeof vnode === "string") return [{ text: `${pad}"${vnode}"`, changed: isChanged }];
    const attrs = Object.entries(vnode.props)
        .filter(([, v]) => typeof v !== "function" && v != null && v !== false)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join("");
    return [
        { text: `${pad}<${vnode.type}${attrs}>`, changed: isChanged },
        ...vnode.children.flatMap((c, i) => treeLines(c, changed, [...path, i], depth + 1)),
    ];
}

// ---- 패널 상세 보기용 ----

// path를 사람이 읽는 위치 설명으로: "루트 <div> › 1번째 <div> › 3번째 <button class="card">"
export function explainPath(root, path) {
    const parts = [`루트 ${label(root)}`];
    let node = root;
    for (const i of path) {
        node = node !== undefined && typeof node !== "string" ? node.children[i] : undefined;
        if (node === undefined) {
            parts.push(`${i}번째 (없음)`);
            break;
        }
        parts.push(`${i}번째 ${label(node)}`);
    }
    return parts.join(" › ");
}

// 패치 하나가 바꾸는 값들 {label, from, to}. from만 있으면 삭제, to만 있으면 추가. 핸들러(함수)는 제외
export function patchChanges(p, oldRoot) {
    const old = getNode(oldRoot, p.path);
    switch (p.op) {
        case "TEXT":
            return [{ label: "글자", from: old, to: p.text }];
        case "PROPS":
            return [
                ...Object.entries(p.set)
                    .filter(([, v]) => typeof v !== "function")
                    .map(([k, v]) => ({ label: k, from: old?.props?.[k], to: v })),
                ...p.remove.map((k) => ({ label: k, from: old?.props?.[k], to: undefined })),
            ];
        case "REPLACE":
            return [{ label: "노드", from: label(old), to: label(p.vnode) }];
        case "CREATE":
            return [{ label: "새 노드", from: undefined, to: label(p.vnode) }];
        case "REMOVE":
            return [{ label: "삭제된 노드", from: label(old), to: undefined }];
        default:
            return [];
    }
}

// hooks 배열 칸의 종류는 모양으로 구분한다: useState {value,setState} / useEffect {deps,cleanup} / useMemo {value,deps}
export function hookKind(slot) {
    return "setState" in slot ? "useState" : "cleanup" in slot ? "useEffect" : "useMemo";
}

export function formatValue(v) {
    if (v === undefined) return "undefined";
    // 카드 객체 배열처럼 읽기 힘든 것만 개수로 줄이고, 숫자 배열이나 deps([[3]])는 그대로 보여 준다
    if (Array.isArray(v) && v.some((x) => x && typeof x === "object" && !Array.isArray(x))) return `배열 ${v.length}개`;
    const s = JSON.stringify(v);
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

// hooks 배열을 표 행으로. prevRows와 비교해 이번에 바뀐 칸(changed)과 이전 값(from)을 표시한다
export function hookRows(hooks, names, prevRows = []) {
    return hooks.map((slot, i) => {
        const kind = hookKind(slot);
        const value = kind === "useEffect" ? slot.deps : slot.value;
        const key = JSON.stringify(value ?? null);
        const before = prevRows[i];
        const changed = Boolean(before) && before.key !== key;
        const row = { index: i, name: names[i] ?? `hook ${i}`, kind, text: formatValue(value), key, changed, from: changed ? before.text : undefined };
        if (kind === "useEffect") row.extra = typeof slot.cleanup === "function" ? "cleanup 등록됨 (정리 대기 중)" : "cleanup 없음";
        return row;
    });
}
