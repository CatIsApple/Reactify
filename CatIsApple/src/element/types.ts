/** Element의 자식이나 함수 컴포넌트의 반환값으로 받을 수 있는 값. 배열은 여러 단계로 중첩할 수 있다. */
export type ElementChild =
  | ReactifyElement
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly ElementChild[];

/** HTML 태그 이름 또는 렌더 중 호출할 함수 컴포넌트. 각 함수의 구체적인 props 타입은 createElement에서 검사한다. */
export type ElementType = string | ((props: never) => ElementChild);

/** createElement가 만든 화면 설명 객체. key는 같은 부모 아래에서 이전 Fiber와 짝을 찾을 때 사용한다. */
export interface ReactifyElement<
  Type extends ElementType = ElementType,
  Props extends object = object,
> {
  readonly type: Type;
  readonly key: string | null;
  readonly props: Readonly<Props> & { readonly children?: ElementChild };
}
