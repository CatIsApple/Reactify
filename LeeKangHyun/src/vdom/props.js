// 속성을 DOM 요소에 적용/제거하는 공용 코드. vnodeToDom과 patch가 같이 쓴다.
const EVENT = /^on[A-Z]/; // onClick, onInput ...
const eventName = (key) => key.slice(2).toLowerCase(); // onKeyDown -> keydown

export function setProp(el, key, value) {
    if (/^on/i.test(key)) {
        // 보안: on*은 함수일 때만 이벤트로 쓰고, 문자열(onclick="...") 등은 attribute로 만들지 않고 무시한다
        if (EVENT.test(key) && typeof value === "function") setHandler(el, eventName(key), value);
        else if (value == null || value === false) removeProp(el, key);
        return;
    }
    if (value === false || value == null) return removeProp(el, key);
    // value, checked는 사용자가 조작한 뒤에는 attribute를 바꿔도 화면이 안 바뀌므로 DOM 프로퍼티로 설정한다
    if (key === "value") el.value = value;
    else if (key === "checked") el.checked = true; // attribute 형태(checked="")도 켜진 상태로 본다
    else el.setAttribute(key, value === true ? "" : String(value));
}

export function removeProp(el, key) {
    if (EVENT.test(key)) {
        const handlers = el.__handlers;
        if (handlers && eventName(key) in handlers) handlers[eventName(key)] = null;
    } else if (key === "value") el.value = "";
    else if (key === "checked") el.checked = false;
    else el.removeAttribute(key);
}

// 리스너는 이벤트 이름마다 한 번만 붙이고, 저장소의 최신 함수를 호출한다 (patch를 반복해도 중복 실행되지 않음)
function setHandler(el, name, fn) {
    const handlers = (el.__handlers ??= {});
    if (!(name in handlers)) el.addEventListener(name, (e) => handlers[name]?.(e));
    handlers[name] = fn;
}
