import { vnodeToDom } from "../vdom/vdom_create.js";
import { diff } from "../diff/diff.js";
import { patch } from "../patch/patch.js";
import { setCurrentComponent } from "../hooks/current_component.js";

const isVNode = (v) =>
    v !== null && typeof v === "object" && typeof v.type === "string" && typeof v.props === "object" && v.props !== null && Array.isArray(v.children);

// 함수형 컴포넌트 fn(props) -> VNode 를 감싸고, 재렌더링에 Phase 1의 diff/patch를 재사용한다.
export class FunctionComponent {
    constructor(fn, props = {}) {
        this.fn = fn;
        this.props = props;
        this.hooks = []; // 다음 단계(useState 등)에서 상태를 저장할 배열
        this.hookIndex = 0;
        this.pendingEffects = []; // useEffect가 예약한 { slot, effect }
        this.oldVNode = null;
        this.dom = null;
    }

    render() {
        this.hookIndex = 0;
        this.pendingEffects = []; // 렌더가 예외로 끝났을 때 이전 예약이 남지 않게 한다
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
        this.runEffects();
    }

    update() {
        if (!this.oldVNode) throw new Error("FunctionComponent: mount되지 않았거나 unmount된 컴포넌트는 update()할 수 없습니다");
        const newVNode = this.render();
        this.dom = patch(this.dom, diff(this.oldVNode, newVNode));
        this.oldVNode = newVNode;
        this.runEffects();
    }

    // DOM 반영 직후 동기 실행한다. (실제 React는 페인트 뒤 비동기로 실행한다)
    runEffects() {
        const effects = this.pendingEffects;
        this.pendingEffects = [];
        for (const { slot, effect } of effects) {
            if (typeof slot.cleanup === "function") slot.cleanup(); // 이전 cleanup을 먼저 호출
            const result = effect();
            slot.cleanup = typeof result === "function" ? result : undefined;
        }
    }

    unmount() {
        for (const slot of this.hooks) {
            if (typeof slot.cleanup === "function") slot.cleanup();
            slot.cleanup = undefined;
        }
        this.dom?.remove();
        this.dom = null;
        this.oldVNode = null;
    }
}
