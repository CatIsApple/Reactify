import { vnodeToDom } from "../vdom/vdom_create.js";

function find(root, path) {
    let node = root;
    for (const i of path) {
        node = node.childNodes[i];
        if (!node) throw new Error(`patch: path [${path}] 에 해당하는 노드가 없습니다`);
    }
    return node;
}

// diff가 만든 patches를 rootDom(path [])에 순서대로 적용한다. 루트가 교체될 수 있으므로 새 루트를 반환한다.
export function patch(rootDom, patches) {
    let root = rootDom;
    for (const p of patches) {
        if (p.op === "CREATE") {
            const parent = find(root, p.path.slice(0, -1));
            if (parent.childNodes.length !== p.path.at(-1)) throw new Error(`patch: CREATE 위치 [${p.path}] 가 DOM과 맞지 않습니다`);
            parent.appendChild(vnodeToDom(p.vnode));
            continue;
        }
        const node = find(root, p.path);
        if (p.op === "REPLACE") {
            const next = vnodeToDom(p.vnode);
            node.replaceWith(next);
            if (node === root) root = next;
        } else if (p.op === "TEXT") {
            node.textContent = p.text;
        } else if (p.op === "PROPS") {
            for (const [k, v] of Object.entries(p.set)) node.setAttribute(k, v);
            for (const k of p.remove) node.removeAttribute(k);
        } else if (p.op === "REMOVE") {
            node.remove();
        } else {
            throw new Error(`patch: 알 수 없는 op ${p.op}`);
        }
    }
    return root;
}
