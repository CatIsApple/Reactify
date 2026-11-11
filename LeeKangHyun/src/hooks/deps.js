// useEffect/useMemo 공용: deps가 없거나(undefined) 이전 값이 없거나 길이·값(Object.is)이 다르면 true
export function depsChanged(prevDeps, nextDeps) {
    return !prevDeps || !nextDeps || prevDeps.length !== nextDeps.length || nextDeps.some((d, j) => !Object.is(d, prevDeps[j]));
}
