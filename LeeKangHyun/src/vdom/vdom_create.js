export function domToVNode(node) {
    console.log("들어온 node:", node, "nodeType:", node.nodeType);
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent.trim() === "" ? null : node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null; //만약 태그가 아니라면 return NULL 시키기
    const props = {};
    for (const a of node.attributes) props[a.name] = a.value;
    //a 객체 에 name 과 vlaue 가 들어있음. name 은 속성 이름, value 는 속성 값
    // props[a.name] 한 이유는 id 값을 = vlaue 로 넣기 위해서
    const children = [...node.childNodes].map(domToVNode).filter((c) => c !== null);
    return { type: node.tagName.toLowerCase(), props, children };
}
export function vnodeToDom(vnode) {
    if (typeof vnode === "string") return document.createTextNode(vnode);
    const el = document.createElement(vnode.type);
    for (const [k, v] of Object.entries(vnode.props)) el.setAttribute(k, v);
    for (const c of vnode.children) el.appendChild(vnodeToDom(c));
    return el;
}
