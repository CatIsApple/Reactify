import { domToVNode, vnodeToDom } from "../vdom/vdom_create.js";
import { diff } from "../diff/diff.js";
import { patch } from "../diff/patch.js";

const realArea = document.getElementById("real-area");
const testArea = document.getElementById("test-area");

// 바깥 래퍼에 id를 붙이면 테스트 영역으로 복사될 때 중복되므로 firstElementChild를 읽는다
let oldVDOM = domToVNode(realArea.firstElementChild);
// domToVNode가 공백 텍스트를 버리므로 실제 영역도 VNode로 다시 그려 childNodes 인덱스를 VNode와 맞춘다
realArea.replaceChildren(vnodeToDom(oldVDOM));
testArea.replaceChildren(vnodeToDom(oldVDOM));
console.log(oldVDOM);

document.getElementById("patch-btn").addEventListener("click", () => {
    const testRoot = testArea.firstElementChild;
    if (!testRoot) {
        alert("테스트 영역이 비어 있습니다.");
        return;
    }
    const newVDOM = domToVNode(testRoot);
    const patches = diff(oldVDOM, newVDOM);
    if (patches.length === 0) return;
    patch(realArea.firstElementChild, patches);
    oldVDOM = newVDOM;
});
