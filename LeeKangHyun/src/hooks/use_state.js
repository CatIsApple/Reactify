// 규칙: 훅은 최상위(루트) 컴포넌트에서만 쓰고, 자식 컴포넌트는 props만 받는 순수 함수다.
// FunctionComponent를 import하지 않아 순환 import가 생기지 않는다. render()가 setCurrentComponent로 알려 준다.
import { getCurrentComponent } from "./current_component.js";

export function useState(initial) { //역할 : 상태를 저장하고, 상태를 바꾸는 함수를 반환한다. (React의 useState와 동일)
    const component = getCurrentComponent();
    if (!component) throw new Error("useState는 컴포넌트 렌더 중에만 호출할 수 있습니다");

    const i = component.hookIndex++;
    if (!component.hooks[i]) {
        const slot = { value: initial };
        // 슬롯 생성 시 한 번만 만들어 렌더가 반복되어도 같은 함수(===)를 반환한다
        slot.setState = (next) => { //이게 실제로 화면에 반영되는 부분임 state를 바꾸면 
                                    //자동으로 바뀐다고 생각했는데 이 부분이 있어서 줄여 말한거임
            if (getCurrentComponent() === component) throw new Error("렌더 도중에는 setState를 호출할 수 없습니다 (무한 루프 방지)");
            const value = typeof next === "function" ? next(slot.value) : next;
            if (Object.is(value, slot.value)) return;
            slot.value = value;
            component.update(); // batching 없이 즉시 재렌더링
        };
        component.hooks[i] = slot;
    }
    const slot = component.hooks[i];
    return [slot.value, slot.setState];
}
