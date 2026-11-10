import { vnodeToDom } from "../vdom/vdom_create.js";
import { diff } from "../diff/diff.js";
import { patch } from "../diff/patch.js";
import { setCurrentComponent } from "../hooks/use_state.js";

const isVNode = (v) =>
    v !== null && typeof v === "object" && typeof v.type === "string" && typeof v.props === "object" && v.props !== null && Array.isArray(v.children);

// 함수형 컴포넌트 fn(props) -> VNode 를 감싸고, 재렌더링에 Phase 1의 diff/patch를 재사용한다.
export class FunctionComponent {
    constructor(fn, props = {}) {
        this.fn = fn;
        this.props = props;
        this.hooks = []; // 다음 단계(useState 등)에서 상태를 저장할 배열
        this.hookIndex = 0;
        this.oldVNode = null;
        this.dom = null;
    }

    render() {
        this.hookIndex = 0;
        const prev = setCurrentComponent(this);
        let vnode;
        try {
            vnode = this.fn(this.props);
        } finally {
            setCurrentComponent(prev);
        }
        if (!isVNode(vnode)) {
            throw new Error(`FunctionComponent: 컴포넌트는 { type, props, children } VNode를 반환해야 합니다 (받은 값: ${JSON.stringify(vnode)})`);
        }
        return vnode;
    }

    mount(container) {
        const vnode = this.render();
        container.replaceChildren(vnodeToDom(vnode));
        this.dom = container.firstElementChild;
        this.oldVNode = vnode;
    }

    update() {
        if (!this.oldVNode) throw new Error("FunctionComponent: update() 전에 mount()를 먼저 호출해야 합니다");
        const newVNode = this.render();
        this.dom = patch(this.dom, diff(this.oldVNode, newVNode));
        this.oldVNode = newVNode;
    }
}
