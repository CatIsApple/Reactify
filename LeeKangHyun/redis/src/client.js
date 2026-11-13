// 미니 Redis 서버를 HTTP로 호출하는 클라이언트 (fetch 기반, 외부 라이브러리 없음).

// 서버에 닿지 못한 경우(연결 거부, DNS 실패 등). 호출자는 "저장소를 쓸 수 없음"으로 처리한다.
export class RedisUnavailableError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = "RedisUnavailableError";
    }
}

// 응답이 제한 시간 안에 오지 않은 경우. 이것도 "쓸 수 없음"의 한 종류라서 RedisUnavailableError를 상속한다.
export class RedisTimeoutError extends RedisUnavailableError {
    constructor(message, options) {
        super(message, options);
        this.name = "RedisTimeoutError";
    }
}

// 서버가 4xx/5xx로 응답한 경우. status로 구분한다.
export class RedisHttpError extends Error {
    constructor(status, message) {
        super(message);
        this.name = "RedisHttpError";
        this.status = status;
    }
}

export class MiniRedisClient {
    #baseUrl;
    #timeoutMs;

    constructor({ baseUrl, timeoutMs = 2000 }) {
        if (typeof baseUrl !== "string" || baseUrl === "") throw new TypeError("baseUrl이 필요합니다");
        this.#baseUrl = baseUrl.replace(/\/+$/, "");
        this.#timeoutMs = timeoutMs;
    }

    async set(key, value, ttlMs) {
        await this.#request("PUT", `/keys/${encodeURIComponent(key)}`, { value, ...(ttlMs === undefined ? {} : { ttlMs }) });
    }

    // 없거나 만료됐으면 undefined
    async get(key) {
        const { status, json } = await this.#request("GET", `/keys/${encodeURIComponent(key)}`, undefined, [404]);
        return status === 404 ? undefined : json.value;
    }

    // 지웠으면 true, 없었으면 false
    async del(key) {
        const { status } = await this.#request("DELETE", `/keys/${encodeURIComponent(key)}`, undefined, [404]);
        return status !== 404;
    }

    // 만료 시간을 걸었으면 true, 키가 없으면 false
    async expire(key, ttlMs) {
        const { status } = await this.#request("POST", `/keys/${encodeURIComponent(key)}/expire`, { ttlMs }, [404]);
        return status !== 404;
    }

    // 남은 ms, 만료 없음 -1, 키 없음 -2 (Store.ttl과 같은 규칙)
    async ttl(key) {
        const { status, json } = await this.#request("GET", `/keys/${encodeURIComponent(key)}/ttl`, undefined, [404]);
        return status === 404 ? -2 : json.ttlMs;
    }

    async incr(key) {
        const { json } = await this.#request("POST", `/keys/${encodeURIComponent(key)}/incr`);
        return json.value;
    }

    // okStatuses: 에러로 보지 않을 4xx 상태 (예: 404는 "없음"이라는 정상 결과)
    async #request(method, path, body, okStatuses = []) {
        let res;
        try {
            res = await fetch(this.#baseUrl + path, {
                method,
                headers: body === undefined ? {} : { "Content-Type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(this.#timeoutMs),
            });
        } catch (err) {
            if (err?.name === "TimeoutError") throw new RedisTimeoutError(`mini redis did not respond within ${this.#timeoutMs}ms`, { cause: err });
            throw new RedisUnavailableError(`mini redis is unreachable: ${err?.cause?.code ?? err?.message}`, { cause: err });
        }

        let json;
        try {
            json = await res.json();
        } catch {
            json = undefined; // JSON이 아닌 응답
        }
        if (!res.ok && !okStatuses.includes(res.status)) throw new RedisHttpError(res.status, json?.error ?? `mini redis responded ${res.status}`);
        return { status: res.status, json };
    }
}
