import { HashTable } from "./hash_table.js";

const isValidTtl = (ttlMs) => typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0;

function checkTtl(ttlMs) {
    if (!isValidTtl(ttlMs)) throw new RangeError("ttlMs는 양의 유한한 숫자여야 합니다");
}

// 해시 테이블 위에 만든 키-값 저장소. 항목은 { value, expiresAt }.
// value는 JSON 문자열로 저장한다: 저장 후 호출자가 객체를 바꿔도 영향이 없고, JSON으로 못 바꾸는 값은 저장 전에 걸러진다.
// 동시성: 모든 명령은 await 없는 동기 함수라 Node의 단일 스레드 이벤트 루프에서 끼어들 틈이 없다 (원자적).
export class Store {
    #table = new HashTable();
    #now;
    #timer = null;

    // 테스트에서 시간을 조작할 수 있게 시계를 주입받는다.
    constructor({ now = Date.now } = {}) {
        this.#now = now;
    }

    set(key, value, ttlMs) {
        if (ttlMs !== undefined) checkTtl(ttlMs);
        const json = JSON.stringify(value);
        if (json === undefined) throw new TypeError("JSON으로 저장할 수 없는 값입니다 (undefined, 함수, 심볼)");
        // 덮어쓸 때는 항목을 새로 만들어 이전 ttl을 지운다
        this.#table.set(key, { value: json, expiresAt: ttlMs === undefined ? null : this.#now() + ttlMs });
    }

    get(key) {
        const entry = this.#live(key);
        return entry ? JSON.parse(entry.value) : undefined;
    }

    del(key) {
        if (!this.#live(key)) return false; // 만료된 키는 이미 없는 것으로 본다
        return this.#table.delete(key);
    }

    exists(key) {
        return this.#live(key) !== undefined;
    }

    expire(key, ttlMs) {
        checkTtl(ttlMs);
        const entry = this.#live(key);
        if (!entry) return false;
        entry.expiresAt = this.#now() + ttlMs;
        return true;
    }

    // Redis 관례: 남은 ms, 만료 없음 -1, 키 없음(또는 만료됨) -2
    ttl(key) {
        const entry = this.#live(key);
        if (!entry) return -2;
        if (entry.expiresAt === null) return -1;
        return entry.expiresAt - this.#now();
    }

    // 없거나 숫자가 아니면 0에서 시작. 읽기와 쓰기가 한 동기 함수 안에 있어 동시에 호출돼도 값이 유실되지 않는다.
    incr(key) {
        const entry = this.#live(key);
        const parsed = entry ? JSON.parse(entry.value) : undefined;
        const next = (typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0) + 1;
        if (entry) entry.value = JSON.stringify(next); // 기존 항목의 만료 시간은 유지
        else this.#table.set(key, { value: JSON.stringify(next), expiresAt: null });
        return next;
    }

    // 만료된 항목은 세지 않는다. 읽기만 하고 지우지는 않는다.
    size() {
        let count = 0;
        for (const key of this.#table.keys()) {
            if (!this.#isExpired(this.#table.get(key))) count++;
        }
        return count;
    }

    // active expiration: 아무도 읽지 않는 만료 항목이 메모리에 남지 않도록 한꺼번에 정리한다.
    sweep() {
        let removed = 0;
        for (const key of this.#table.keys()) {
            // keys()는 복사본이라 순회 중에 지워도 안전하다
            if (this.#isExpired(this.#table.get(key))) {
                this.#table.delete(key);
                removed++;
            }
        }
        return removed;
    }

    startSweeper(intervalMs) {
        checkTtl(intervalMs);
        this.stopSweeper(); // 두 번 시작해도 타이머가 겹치지 않게
        this.#timer = setInterval(() => this.sweep(), intervalMs);
        this.#timer.unref(); // 이 타이머 때문에 프로세스가 종료되지 못하는 일을 막는다
    }

    stopSweeper() {
        clearInterval(this.#timer);
        this.#timer = null;
    }

    #isExpired(entry) {
        return entry.expiresAt !== null && entry.expiresAt <= this.#now();
    }

    // lazy expiration: 읽는 순간 만료를 확인하고 그 자리에서 지운다.
    #live(key) {
        const entry = this.#table.get(key);
        if (!entry) return undefined;
        if (this.#isExpired(entry)) {
            this.#table.delete(key);
            return undefined;
        }
        return entry;
    }
}
