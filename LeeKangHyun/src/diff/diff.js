// 순수 함수: DOM에 접근하지 않고 patch 객체 배열만 반환한다. key 비교는 하지 않는다.
export function diff(oldV, newV, path = [], patches = []) {
    if (typeof oldV === "string" && typeof newV === "string") {
        if (oldV !== newV) patches.push({ op: "TEXT", path, text: newV });
        return patches;
    }
    if (typeof oldV === "string" || typeof newV === "string" || oldV.type !== newV.type) {
        patches.push({ op: "REPLACE", path, vnode: newV });
        return patches;
    }

    const set = {};
    const remove = [];
    for (const [k, v] of Object.entries(newV.props)) if (oldV.props[k] !== v) set[k] = v;
    for (const k of Object.keys(oldV.props)) if (!(k in newV.props)) remove.push(k);
    if (Object.keys(set).length || remove.length) patches.push({ op: "PROPS", path, set, remove });

    const oldC = oldV.children;
    const newC = newV.children;
    const common = Math.min(oldC.length, newC.length);
    for (let i = 0; i < common; i++) diff(oldC[i], newC[i], [...path, i], patches);
    for (let i = common; i < newC.length; i++) patches.push({ op: "CREATE", path: [...path, i], vnode: newC[i] });
    // 큰 인덱스부터 삭제해야 적용 중 인덱스가 밀리지 않는다
    for (let i = oldC.length - 1; i >= common; i--) patches.push({ op: "REMOVE", path: [...path, i] });
    return patches;
}
