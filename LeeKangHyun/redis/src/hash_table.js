// FNV-1a 32비트 해시: 문자열을 0 ~ 2^32-1 사이의 정수로 바꾼다.
export function fnv1a(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193); // 32비트 곱셈 (일반 *는 정밀도가 깨진다)
    }
    return hash >>> 0; // 부호 없는 정수로
}

const MAX_LOAD_FACTOR = 0.75;

// Map/Object를 쓰지 않는 해시 테이블: 버킷 배열 + 체이닝.
// 같은 버킷에 걸린 항목은 [key, value] 배열의 목록(체인)에 저장한다.
export class HashTable {
    #buckets;
    #size = 0;
    #hash;

    // 테스트에서 충돌을 강제할 수 있게 초기 용량과 해시 함수를 주입받는다.
    constructor(capacity = 8, hash = fnv1a) {
        if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacity는 1 이상의 정수여야 합니다");
        if (typeof hash !== "function") throw new TypeError("hash는 함수여야 합니다");
        this.#buckets = new Array(capacity).fill(null);
        this.#hash = hash;
    }

    get size() {
        return this.#size;
    }

    get capacity() {
        return this.#buckets.length;
    }

    set(key, value) {
        checkKey(key);
        const chain = this.#chainFor(key, true);
        const entry = chain.find((e) => e[0] === key);
        if (entry) {
            entry[1] = value; // 같은 키는 덮어쓰기: 개수는 그대로
            return;
        }
        chain.push([key, value]);
        this.#size++;
        if (this.#size / this.#buckets.length > MAX_LOAD_FACTOR) this.#resize(this.#buckets.length * 2);
    }

    get(key) {
        checkKey(key);
        return this.#chainFor(key, false)?.find((e) => e[0] === key)?.[1];
    }

    has(key) {
        checkKey(key);
        return Boolean(this.#chainFor(key, false)?.some((e) => e[0] === key));
    }

    delete(key) {
        checkKey(key);
        const chain = this.#chainFor(key, false);
        const i = chain ? chain.findIndex((e) => e[0] === key) : -1;
        if (i === -1) return false;
        chain.splice(i, 1);
        this.#size--;
        return true;
    }

    keys() {
        const result = [];
        for (const chain of this.#buckets) {
            if (chain) for (const entry of chain) result.push(entry[0]);
        }
        return result;
    }

    #index(key, capacity) {
        return (this.#hash(key) >>> 0) % capacity;
    }

    #chainFor(key, create) {
        const i = this.#index(key, this.#buckets.length);
        if (!this.#buckets[i] && create) this.#buckets[i] = [];
        return this.#buckets[i];
    }

    // 버킷 수가 바뀌면 "해시 % 버킷 수" 결과가 달라지므로 모든 항목을 새 자리에 다시 넣어야 한다 (rehash).
    #resize(newCapacity) {
        const old = this.#buckets;
        this.#buckets = new Array(newCapacity).fill(null);
        for (const chain of old) {
            if (!chain) continue;
            for (const entry of chain) {
                const i = this.#index(entry[0], newCapacity);
                (this.#buckets[i] ??= []).push(entry);
            }
        }
    }
}

function checkKey(key) {
    if (typeof key !== "string" || key === "") throw new TypeError("키는 비어 있지 않은 문자열이어야 합니다");
}
