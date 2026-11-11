// 규칙: 훅은 최상위(루트) 컴포넌트에서만 쓰고, 자식 컴포넌트는 props만 받는 순수 함수다.
import { getCurrentComponent } from "./current_component.js";
import { depsChanged } from "./deps.js";

// 렌더 중에는 실행하지 않고 예약만 한다. 실제 실행은 FunctionComponent.runEffects()가 DOM 반영 직후 한다.
export function useEffect(effect, deps) {
    const component = getCurrentComponent();
    if (!component) throw new Error("useEffect는 컴포넌트 렌더 중에만 호출할 수 있습니다");
    if (typeof effect !== "function") throw new Error("useEffect의 첫 번째 인자는 함수여야 합니다");

    const i = component.hookIndex++;
    const prev = component.hooks[i];
    const changed = !prev || depsChanged(prev.deps, deps);

    const slot = prev ?? { deps, cleanup: undefined };
    component.hooks[i] = slot;
    if (changed) {
        slot.deps = deps;
        component.pendingEffects.push({ slot, effect });
    }
}
