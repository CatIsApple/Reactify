import { domToVNode, vnodeToDom } from "../vdom/vdom_create.js";

const realArea = document.getElementById("real-area");
const testArea = document.getElementById("test-area");

// 바깥 래퍼에 id를 붙이면 테스트 영역으로 복사될 때 중복되므로 firstElementChild를 읽는다
const oldVDOM = domToVNode(realArea.firstElementChild);
testArea.replaceChildren(vnodeToDom(oldVDOM));
console.log(oldVDOM);
