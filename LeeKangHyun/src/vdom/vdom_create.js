function domToVNode(node) {
    console.log("들어온 node:", node, "nodeType:", node.nodeType);
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent.trim() === "" ? null : node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null; //만약 태그가 아니라면 return NULL 시키기
    const props = {};
    for (const a of node.attributes) props[a.name] = a.value;
    const children = [...node.childNodes].map(domToVNode).filter((c) => c !== null);
    return { type: node.tagName.toLowerCase(), props, children };
}
let DOM = document.getElementById("DOM"); // DOM 객체 가져오기
let VDOM = domToVNode(DOM); //DOM 을 VNode 로 변환
console.log(VDOM);