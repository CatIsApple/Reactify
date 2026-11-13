import type { ElementChild, ElementType, ReactifyElement } from './types.js';

/** 생성자가 받은 평범한 props 객체를 그대로 반환해 공개 필드와 프로토타입을 보존한다. */
class PropsIdentity {
  constructor(props: object) { return props; }
}

/** 팩토리의 HTML props에만 비공개 표식을 붙인다. Proxy도 트랩 실행 없이 판별한다. */
export class FactoryHostProps extends PropsIdentity {
  #owned = true;

  /** 일반 객체 두 개만 비교한다. 상속 체인을 바꾼 props도 커밋 경로로 보낸다. */
  static canCompare(previous: object, next: object): boolean {
    return #owned in previous && #owned in next &&
      Object.getPrototypeOf(previous) === Object.prototype && Object.getPrototypeOf(next) === Object.prototype;
  }
}

/** createElement의 두 번째 인자. 일반 props와 함께 key와 기본 children을 받을 수 있다. */
type ElementConfig = object & { key?: unknown; children?: ElementChild };

/**
 * key를 제외한 최종 props 타입을 계산한다. 자식 인자가 없으면 설정의 children을 유지하고,
 * 하나면 그 값의 타입을, 여러 개면 전달받은 자식 배열의 타입을 사용한다.
 */
type PropsFor<Config, Children extends readonly ElementChild[]> = Children extends readonly []
  ? Omit<Config, 'key'>
  : Omit<Config, 'key' | 'children'> & {
      children: Children extends readonly [infer Only] ? Only : Children;
    };

/** 태그나 함수로 Element를 만든다. TypeScript는 호출부에서 props와 자식이 함수 컴포넌트의 입력 타입에 맞는지 검사한다. */
export function createElement<
  Type extends ElementType,
  Config extends object | null = null,
  const Children extends ElementChild[] = [],
>(
  type: Type & (string | ((props: NoInfer<PropsFor<Config, Children>>) => ElementChild)),
  config?: Config & (ElementConfig | null),
  ...children: Children
): ReactifyElement<Type, PropsFor<Config, Children>>;
/** 설정을 얕게 복사하고 key를 분리한 뒤, 자식 인자 개수에 맞춰 props.children을 정한다. */
export function createElement(
  type: ElementType,
  config: ElementConfig | null = null,
  ...children: ElementChild[]
): ReactifyElement {
  let props: ElementConfig = config === null ? {} : { ...config };
  let key: string | null = null;
  if (config !== null && Object.hasOwn(props, 'key')) {
    // 복사본에서 분리하므로 원본 getter 순서와 Symbol 속성을 유지하고 props에 delete를 쓰지 않는다.
    const { key: rawKey, ...componentProps } = props;
    key = rawKey === undefined ? null : String(rawKey);
    props = componentProps;
  }

  if (children.length === 1) {
    props.children = children[0];
  } else if (children.length > 1) {
    props.children = children;
  }

  if (typeof type === 'string') new FactoryHostProps(props);
  return { type, key, props };
}
