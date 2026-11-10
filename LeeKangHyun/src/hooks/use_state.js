// 규칙: 훅은 최상위(루트) 컴포넌트에서만 쓰고, 자식 컴포넌트는 props만 받는 순수 함수다.
// FunctionComponent를 import하지 않아 순환 import가 생기지 않는다. render()가 setCurrentComponent로 알려 준다.
let currentComponent = null;

// 현재 렌더 중인 컴포넌트를 설정하고 이전 값을 돌려준다 (렌더 끝에 복원하기 위해)
export function setCurrentComponent(component) {
    const prev = currentComponent;
    currentComponent = component;
    return prev;
}

export function useState(initial) {
    const component = currentComponent;
    if (!component) throw new Error("useState는 컴포넌트 렌더 중에만 호출할 수 있습니다");

    const i = component.hookIndex++;
    if (!component.hooks[i]) {
        const slot = { value: initial };
        // 슬롯 생성 시 한 번만 만들어 렌더가 반복되어도 같은 함수(===)를 반환한다
        slot.setState = (next) => {
            if (currentComponent === component) throw new Error("렌더 도중에는 setState를 호출할 수 없습니다 (무한 루프 방지)");
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
