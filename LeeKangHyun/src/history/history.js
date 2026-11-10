// DOM 비의존 순수 모듈. VNode는 diff/patch가 수정하지 않으므로 복사하지 않고 참조만 보관한다.
export function createHistory(initial) { //초기 상태
    const states = [initial];
    let index = 0;

    const move = (to) => {
        if (to < 0 || to >= states.length) return null; // 위치가 0번째 면 뒤로 더이상 못가게 막기
        index = to;
        return states[index]; // DOM 에 적용하기 위해 현재 상태를 반환한다.
    };

    return {
        current: () => states[index],//지금 위치의 상태를 반환
        canBack: () => index > 0, //뒤로갈수있나 참/거짓
        canForward: () => index < states.length - 1, //앞으로 갈수있나 참/거짓
        position: () => index + 1, //페이지 VDOM 순서 코드
        size: () => states.length, //페이지 VDOM 순서 코드
        back: () => move(index - 1), //한칸 뒤로 갈수있나.
        forward: () => move(index + 1), //한칸 앞으로 갈수있나.
        push(vnode) {//새로운 VDOME를 추가. 앞으로가기 기록이 있으면 삭제하고 새로 추가한다.
            states.length = index + 1; // 앞으로가기 기록 삭제
            states.push(vnode); //끝에 추가
            index = states.length - 1; //위치를 마지막으로 이동
        },
    };
}
