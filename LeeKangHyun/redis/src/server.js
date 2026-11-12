import http from "node:http";
import { pathToFileURL } from "node:url";
import { Store } from "./store.js";

const MAX_KEY_LENGTH = 512;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1MB

// 상태 코드를 가진 에러: 요청이 잘못된 경우에만 사용하고, 그 외의 예외는 500으로 처리한다.
class HttpError extends Error {
    constructor(status, message, headers = {}) {
        super(message);
        this.status = status;
        this.headers = headers;
    }
}

// store 명령은 모두 동기 함수다. 본문을 읽는 부분만 비동기이고, 읽은 뒤의 store 호출은 한 번에 끝나서
// 다른 요청이 중간에 끼어들 수 없다 (그래서 incr 같은 읽기-쓰기도 요청 사이에서 유실되지 않는다).
export function createApp(store, { corsOrigin = "*", logger = null, maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
    const routes = buildRoutes(store, maxBodyBytes);

    return http.createServer(async (req, res) => {
        const started = Date.now();
        let failure = null;
        res.on("finish", () => logger?.({ method: req.method, path: req.url, status: res.statusCode, ms: Date.now() - started, error: failure }));

        const send = (status, body, headers = {}) => {
            const text = status === 204 ? "" : JSON.stringify(body);
            res.writeHead(status, {
                "Access-Control-Allow-Origin": corsOrigin,
                "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                ...(status === 204 ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }),
                ...headers,
            });
            res.end(text);
        };

        try {
            if (req.method === "OPTIONS") return send(204); // CORS 프리플라이트
            const path = req.url.split("?")[0]; // URL 객체를 쓰면 ".." 같은 키가 경로 정규화로 사라지므로 직접 자른다
            const route = routes.find((r) => r.pattern.test(path));
            if (!route) throw new HttpError(404, "not found");
            const handler = route.methods[req.method];
            if (!handler) throw new HttpError(405, "method not allowed", { Allow: Object.keys(route.methods).join(", ") });

            const match = path.match(route.pattern);
            const key = match[1] === undefined ? undefined : decodeKey(match[1]);
            const { status, body } = await handler({ req, key });
            send(status, body);
        } catch (err) {
            if (err instanceof HttpError) return send(err.status, { error: err.message }, err.headers);
            failure = err; // 내부 정보는 로그로만 남기고 응답에는 노출하지 않는다
            send(500, { error: "internal error" });
        }
    });
}

function buildRoutes(store, maxBodyBytes) {
    const reply = (status, body) => ({ status, body });
    const notFound = (key) => reply(404, { error: `key not found: ${key}` });

    return [
        { pattern: /^\/health$/, methods: { GET: () => reply(200, { status: "ok" }) } },
        { pattern: /^\/stats$/, methods: { GET: () => reply(200, { size: store.size() }) } },
        {
            pattern: /^\/keys\/([^/]*)$/,
            methods: {
                async PUT({ req, key }) {
                    const body = await readJsonObject(req, maxBodyBytes);
                    if (!("value" in body)) throw new HttpError(400, "value is required");
                    const ttlMs = body.ttlMs;
                    const existed = store.exists(key); // 존재 확인과 set 사이에 다른 요청이 끼어들 수 없다
                    setOrBadRequest(() => store.set(key, body.value, ttlMs));
                    return reply(existed ? 200 : 201, { key, ttlMs: ttlMs ?? null });
                },
                GET({ key }) {
                    const value = store.get(key); // JSON null도 값이므로 undefined인지로만 없는 키를 구분한다
                    const ttl = store.ttl(key);
                    if (value === undefined || ttl === -2) return notFound(key);
                    return reply(200, { key, value, ttlMs: ttl === -1 ? null : ttl });
                },
                DELETE({ key }) {
                    return store.del(key) ? reply(200, { deleted: true }) : notFound(key);
                },
            },
        },
        {
            pattern: /^\/keys\/([^/]*)\/expire$/,
            methods: {
                async POST({ req, key }) {
                    const body = await readJsonObject(req, maxBodyBytes);
                    const ok = setOrBadRequest(() => store.expire(key, body.ttlMs));
                    return ok ? reply(200, { key, ttlMs: body.ttlMs }) : notFound(key);
                },
            },
        },
        {
            // ttlMs: 남은 ms, 만료 없음은 -1 (키가 없거나 만료되면 -2 대신 404로 응답)
            pattern: /^\/keys\/([^/]*)\/ttl$/,
            methods: {
                GET({ key }) {
                    const ttl = store.ttl(key);
                    return ttl === -2 ? notFound(key) : reply(200, { key, ttlMs: ttl });
                },
            },
        },
        {
            pattern: /^\/keys\/([^/]*)\/incr$/,
            methods: { POST: ({ key }) => reply(200, { key, value: store.incr(key) }) },
        },
    ];
}

// 키는 URL 인코딩된 경로 조각이다. 경로를 "/"로 나눈 뒤에 복원해야 %2F가 들어간 키가 살아남는다.
function decodeKey(raw) {
    let key;
    try {
        key = decodeURIComponent(raw);
    } catch {
        throw new HttpError(400, "invalid key encoding");
    }
    if (key === "") throw new HttpError(400, "key must not be empty");
    if (key.length > MAX_KEY_LENGTH) throw new HttpError(400, `key must be at most ${MAX_KEY_LENGTH} characters`);
    return key;
}

// store가 던지는 RangeError(잘못된 ttl)는 클라이언트 잘못이므로 400으로 바꾼다. 그 밖의 예외는 그대로 500이 된다.
function setOrBadRequest(fn) {
    try {
        return fn();
    } catch (err) {
        if (err instanceof RangeError) throw new HttpError(400, err.message);
        throw err;
    }
}

async function readJsonObject(req, limit) {
    const text = await readBody(req, limit);
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        throw new HttpError(400, "invalid JSON body");
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "body must be a JSON object");
    return body;
}

// 본문 크기를 제한하는 이유: 제한이 없으면 큰 요청 하나가 서버 메모리를 다 쓸 수 있다.
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const tooLarge = () => new HttpError(413, "payload too large", { Connection: "close" });
        if (Number(req.headers["content-length"]) > limit) {
            req.resume(); // 본문은 읽지 않고 버린다
            return reject(tooLarge());
        }
        const chunks = [];
        let size = 0;
        let rejected = false;
        req.on("data", (chunk) => {
            if (rejected) return; // 이미 거절했다면 남은 데이터는 저장하지 않고 버린다
            size += chunk.length;
            if (size > limit) {
                rejected = true;
                chunks.length = 0;
                return reject(tooLarge());
            }
            chunks.push(chunk);
        });
        req.on("end", () => !rejected && resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

// SIGINT/SIGTERM 처리용: sweeper를 멈추고 새 연결을 막은 뒤, 진행 중인 요청이 끝나면 resolve
export function shutdown(server, store) {
    store.stopSweeper();
    return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeIdleConnections?.(); // 쉬고 있는 keep-alive 연결이 종료를 붙잡지 않게
    });
}

function main() {
    const port = Number(process.env.PORT ?? 3000);
    const store = new Store();
    store.startSweeper(1000);
    const server = createApp(store, { logger: ({ method, path, status, ms, error }) => console.log(`${method} ${path} ${status} ${ms}ms`, error ?? "") });
    server.listen(port, () => console.log(`mini-redis listening on http://localhost:${port}`));

    let closing = false;
    const stop = (signal) => {
        if (closing) return;
        closing = true;
        console.log(`${signal} received, shutting down`);
        setTimeout(() => process.exit(1), 5000).unref(); // 종료가 끝나지 않을 때의 안전장치
        shutdown(server, store).then(() => process.exit(0), () => process.exit(1));
    };
    process.on("SIGINT", () => stop("SIGINT"));
    process.on("SIGTERM", () => stop("SIGTERM"));
}

// `node src/server.js`로 직접 실행했을 때만 서버를 띄운다 (테스트에서 import할 때는 띄우지 않는다)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
