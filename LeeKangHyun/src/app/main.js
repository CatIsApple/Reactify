import { domToVNode, vnodeToDom } from "../vdom/vdom_create.js";
import { diff } from "../diff/diff.js";
import { patch } from "../diff/patch.js";
import { createHistory } from "../history/history.js";

const realArea = document.getElementById("real-area");
const testArea = document.getElementById("test-area");
const patchBtn = document.getElementById("patch-btn");
const backBtn = document.getElementById("back-btn");
const forwardBtn = document.getElementById("forward-btn");

// 바깥 래퍼에 id를 붙이면 테스트 영역으로 복사될 때 중복되므로 firstElementChild를 읽는다
let oldVDOM = domToVNode(realArea.firstElementChild);
// domToVNode가 공백 텍스트를 버리므로 실제 영역도 VNode로 다시 그려 childNodes 인덱스를 VNode와 맞춘다
realArea.replaceChildren(vnodeToDom(oldVDOM));
testArea.replaceChildren(vnodeToDom(oldVDOM));
console.log(oldVDOM);

const history = createHistory(oldVDOM);

function updateButtons() {
    backBtn.disabled = !history.canBack();
    forwardBtn.disabled = !history.canForward();
}
updateButtons();

patchBtn.addEventListener("click", () => {
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
    history.push(newVDOM);
    updateButtons();
});

// 실제 영역은 바뀐 곳만 patch하고, 테스트 영역은 target으로 다시 그린다
function goTo(target) {
    if (!target) return;
    patch(realArea.firstElementChild, diff(oldVDOM, target));
    testArea.replaceChildren(vnodeToDom(target));
    oldVDOM = target;
    updateButtons();
}

backBtn.addEventListener("click", () => goTo(history.back()));
forwardBtn.addEventListener("click", () => goTo(history.forward()));
