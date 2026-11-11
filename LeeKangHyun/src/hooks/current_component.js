// 현재 렌더 중인 컴포넌트 추적. useState/useEffect가 공유하며 FunctionComponent를 import하지 않아 순환 import가 없다.
let currentComponent = null;

// 현재 렌더 중인 컴포넌트를 설정하고 이전 값을 돌려준다 (렌더 끝에 복원하기 위해)
export function setCurrentComponent(component) {
    const prev = currentComponent;
    currentComponent = component;
    return prev;
}

export function getCurrentComponent() {
    return currentComponent;
}
