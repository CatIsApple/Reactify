// 규칙: 훅은 최상위(루트) 컴포넌트에서만 쓰고, 자식 컴포넌트는 props만 받는 순수 함수다.
import { getCurrentComponent } from "./current_component.js";
import { depsChanged } from "./deps.js";

// useEffect와 달리 렌더 중에 factory를 동기 실행하고, deps가 같으면 저장된 값을 그대로 돌려준다.
export function useMemo(factory, deps) {
    const component = getCurrentComponent();
    if (!component) throw new Error("useMemo는 컴포넌트 렌더 중에만 호출할 수 있습니다");
    if (typeof factory !== "function") throw new Error("useMemo의 첫 번째 인자는 함수여야 합니다");

    const i = component.hookIndex++;
    const prev = component.hooks[i];
    if (prev && !depsChanged(prev.deps, deps)) return prev.value;

    const value = factory(); // 예외가 나면 슬롯을 갱신하지 않으므로 캐시되지 않고 다음 렌더에 다시 시도한다
    component.hooks[i] = { value, deps };
    return value;
}
