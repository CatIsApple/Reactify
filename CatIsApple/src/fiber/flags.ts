/** 한 Fiber 또는 그 자손에 필요한 커밋 작업을 비트 단위로 합친 값. */
export type Flags = number;

/** 커밋에서 처리할 변경이 없다. */
export const NoFlags = 0;
/** 이 Fiber에 속한 DOM을 부모에 삽입하거나 새 형제 위치로 이동한다. */
export const Placement = 1 << 0;
/** 기존 DOM 노드의 속성이나 텍스트를 갱신한다. */
export const Update = 1 << 1;
/** 부모 Fiber의 deletions에 기록된 이전 자식들을 제거한다. */
export const ChildDeletion = 1 << 2;
/** HostRoot의 첫 커밋에서 자식을 삽입하기 전에 컨테이너를 비운다. */
export const Snapshot = 1 << 3;
/** DOM 커밋 뒤 이 함수 컴포넌트의 useEffect를 정리·실행해야 한다. */
export const Passive = 1 << 4;
/** 호스트가 직접 표시하던 텍스트를 새 Fiber 자식이 삽입되기 전에 비운다. */
export const ContentReset = 1 << 5;
/** DOM 변경 단계에서 확인하는 플래그의 합집합. */
export const MutationMask = Placement | Update | ChildDeletion | ContentReset;
/** 새 effect 또는 삭제된 가지의 cleanup을 찾을 때 확인하는 플래그다. */
export const PassiveMask = Passive | ChildDeletion;
