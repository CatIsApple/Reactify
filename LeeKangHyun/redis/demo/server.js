import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MiniRedisClient, RedisHttpError, RedisUnavailableError } from "../src/client.js";
import { DbNotSeededError, openDb } from "./db.js";
import { DUMMY_CREDENTIAL, SESSION_ID_PATTERN, loadUsers, newSessionId, parseCookies, verifyPassword } from "./auth.js";

const DEMO_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(DEMO_DIR, "web");
const MINI_REACT_ROOT = path.resolve(DEMO_DIR, "../../src"); // 상위 폴더의 미니 React (읽기 전용으로만 제공)

// 정해진 확장자만 제공한다. 목록에 없는 파일(.env, .md 등)은 있어도 404다.
const MIME_TYPES = new Map([
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".css", "text/css; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".svg", "image/svg+xml"],
    [".png", "image/png"],
    [".ico", "image/x-icon"],
]);

class HttpError extends Error {
    constructor(status, message, headers = {}) {
        super(message);
        this.status = status;
        this.headers = headers;
    }
}

const reply = (status, body, headers = {}) => ({ status, body, headers });

// 이 서버가 세션 저장소(미니 Redis)와 주고받는 모든 호출은 await 사이에 다른 요청이 끼어들 수 있다.
// 그래서 "incr 후 expire" 같은 여러 호출의 묶음은 원자적이지 않다 (README 참고).
export function createDemoApp({
    redisClient,
    users,
    db, // 대시보드 원본 데이터 출처: { getDashboardStats(username) } (demo/db.js, 나중에 다른 DBMS로 교체 가능)
    sessionTtlMs = 30 * 60 * 1000,
    maxLoginFailures = 5,
    lockoutMs = 5 * 60 * 1000,
    dashboardDelayMs = 0, // 기본은 인위적인 지연 없이 진짜 SQL 조회. 느린 원본을 흉내 내고 싶을 때만 DASHBOARD_DELAY_MS를 준다
    dashboardCacheTtlMs = 30_000,
    maxBodyBytes = 1024 * 1024,
    logger = null,
    webRoot = WEB_ROOT,
    miniReactRoot = MINI_REACT_ROOT,
}) {
    if (typeof db?.getDashboardStats !== "function") throw new TypeError("db.getDashboardStats가 필요합니다");
    const sessionKey = (sid) => `session:${sid}`;
    const sessionCookie = (sid) => `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}`;
    const clearedCookie = "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
    // Secure 속성은 HTTPS에서만 쿠키를 보내는 설정인데, 이 데모는 로컬 HTTP라서 붙이지 않았다 (README 참고).

    // ---- 세션 ----

    // 쿠키의 sid로 세션을 찾고, 찾으면 만료 시간을 다시 늘린다 (sliding expiration).
    async function authenticate(req) {
        const sid = parseCookies(req.headers.cookie).get("sid");
        if (!sid || !SESSION_ID_PATTERN.test(sid)) return null; // 형식이 틀리면 저장소를 조회하지 않는다
        const session = await redisClient.get(sessionKey(sid));
        if (!session || typeof session.username !== "string") return null;
        if (!(await redisClient.expire(sessionKey(sid), sessionTtlMs))) return null; // 그 사이에 만료됐다
        return { sid, username: session.username };
    }

    async function requireSession(req) {
        const auth = await authenticate(req);
        if (!auth) throw new HttpError(401, "not authenticated");
        return auth;
    }

    // ---- API 핸들러 ----

    async function login({ req }) {
        const { username, password } = await readJsonObject(req, maxBodyBytes);
        if (typeof username !== "string" || typeof password !== "string" || username === "" || password === "" || username.length > 128 || password.length > 128) {
            throw new HttpError(400, "username and password are required");
        }

        // 로그인 시도 제한: 아이디가 존재하든 아니든 똑같이 적용해서 응답 차이로 아이디를 알아내지 못하게 한다.
        const failKey = `login_fail:${username}`;
        const failures = (await redisClient.get(failKey)) ?? 0;
        if (failures >= maxLoginFailures) {
            const ttl = await redisClient.ttl(failKey);
            const retryAfterSec = ttl > 0 ? Math.ceil(ttl / 1000) : Math.ceil(lockoutMs / 1000);
            return reply(429, { error: "too many failed attempts" }, { "Retry-After": String(retryAfterSec) });
        }

        const user = users.get(username);
        // 없는 아이디에도 가짜 계정으로 같은 해시 계산을 해서 응답 시간 차이로 아이디 존재 여부를 알 수 없게 한다.
        const passwordOk = await verifyPassword(password, user ?? DUMMY_CREDENTIAL);
        if (!user || !passwordOk) {
            const count = await redisClient.incr(failKey);
            // incr와 expire는 서로 다른 HTTP 호출이라 그 사이에 멈추면 만료 없는 카운터가 남을 수 있다. 만료가 없으면 다시 건다.
            if (count === 1 || (await redisClient.ttl(failKey)) === -1) await redisClient.expire(failKey, lockoutMs);
            return reply(401, { error: "invalid credentials" });
        }

        await redisClient.del(failKey);
        const sid = newSessionId();
        await redisClient.set(sessionKey(sid), { username, createdAt: Date.now() }, sessionTtlMs);
        return reply(200, { username }, { "Set-Cookie": sessionCookie(sid) });
    }

    async function me({ req }) {
        const { sid, username } = await requireSession(req);
        // 쿠키의 Max-Age도 같이 늘려야 브라우저가 쿠키를 먼저 버리지 않는다
        return reply(200, { username, expiresInMs: sessionTtlMs }, { "Set-Cookie": sessionCookie(sid) });
    }

    async function logout({ req }) {
        const sid = parseCookies(req.headers.cookie).get("sid");
        try {
            if (sid && SESSION_ID_PATTERN.test(sid)) await redisClient.del(sessionKey(sid)); // 세션이 없어도 성공으로 본다 (멱등)
        } catch (err) {
            if (!isStoreError(err)) throw err;
            // 서버의 세션은 지우지 못했지만 브라우저의 쿠키는 지운다. 세션은 만료 시간에 저절로 사라진다.
            return reply(503, { error: "session store unavailable" }, { "Set-Cookie": clearedCookie });
        }
        return reply(200, { ok: true }, { "Set-Cookie": clearedCookie });
    }

    // mode=db는 매번 SQL 조회, mode=redis는 cache-aside(캐시에 있으면 그것을, 없으면 DB를 읽고 캐시에 저장).
    // 예전의 ?cache=off는 mode=db와 같은 뜻이다. mode가 함께 있으면 mode가 우선한다.
    function dashboardMode(query) {
        const mode = query.get("mode");
        if (mode === null) return query.get("cache") === "off" ? "db" : "redis";
        if (mode !== "db" && mode !== "redis") throw new HttpError(400, "mode must be db or redis");
        return mode;
    }

    async function dashboard({ req, query }) {
        const { username } = await requireSession(req);
        const mode = dashboardMode(query);
        const cacheKey = `cache:dashboard:${username}`; // 사용자별 키라서 다른 사용자의 데이터가 섞이지 않는다
        const started = performance.now();
        // 정수로 반올림하지 않는다: 3ms와 0.4ms의 차이가 보여야 하기 때문
        const elapsedMs = () => Math.round((performance.now() - started) * 100) / 100;

        if (mode === "redis") {
            const cached = await redisClient.get(cacheKey);
            if (cached !== undefined) return reply(200, { data: cached, source: "redis", elapsedMs: elapsedMs() }, { "X-Source": "redis", "X-Cache": "HIT" });
        }
        // SQLite 조회는 동기 호출이라 실행하는 동안 이 서버의 다른 요청이 기다린다 (단일 스레드)
        const data = db.getDashboardStats(username);
        if (dashboardDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, dashboardDelayMs));
        if (mode === "redis") await redisClient.set(cacheKey, data, dashboardCacheTtlMs);
        return reply(200, { data, source: "db", elapsedMs: elapsedMs() }, { "X-Source": "db", "X-Cache": mode === "redis" ? "MISS" : "BYPASS" });
    }

    // 무효화: 원본이 바뀌었다고 가정하고 캐시를 직접 지운다
    async function clearDashboardCache({ req }) {
        const { username } = await requireSession(req);
        return reply(200, { deleted: await redisClient.del(`cache:dashboard:${username}`) });
    }

    const apiRoutes = new Map([
        ["/api/login", { POST: login }],
        ["/api/me", { GET: me }],
        ["/api/logout", { POST: logout }],
        ["/api/dashboard", { GET: dashboard }],
        ["/api/dashboard/cache", { DELETE: clearDashboardCache }],
    ]);

    // ---- 서버 ----

    return http.createServer(async (req, res) => {
        const started = Date.now();
        let failure = null;
        res.on("finish", () => logger?.({ method: req.method, path: req.url, status: res.statusCode, ms: Date.now() - started, error: failure }));

        const sendJson = (status, body, headers = {}) => {
            const text = JSON.stringify(body);
            res.writeHead(status, {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(text),
                "Cache-Control": "no-store", // 세션 관련 응답이 캐시되지 않게
                "X-Content-Type-Options": "nosniff",
                ...headers,
            });
            res.end(text);
        };

        try {
            const [path_, queryString = ""] = req.url.split("?"); // URL 객체는 경로를 정규화해서 쓰지 않는다
            if (path_.startsWith("/api/")) {
                const route = apiRoutes.get(path_);
                if (!route) throw new HttpError(404, "not found");
                const handler = Object.hasOwn(route, req.method) ? route[req.method] : undefined;
                if (!handler) throw new HttpError(405, "method not allowed", { Allow: Object.keys(route).join(", ") });
                // 상태를 바꾸는 POST는 application/json만 받는다. HTML 폼은 이 타입을 보낼 수 없어서 단순한 CSRF 폼 전송이 막힌다.
                if (req.method === "POST" && !isJson(req)) throw new HttpError(415, "Content-Type must be application/json");
                const { status, body, headers } = await handler({ req, query: new URLSearchParams(queryString) });
                return sendJson(status, body, headers);
            }
            return await serveStatic(req, res, path_);
        } catch (err) {
            if (err instanceof HttpError) return sendJson(err.status, { error: err.message }, err.headers);
            failure = err; // 내부 정보는 로거에만 남기고 응답에는 노출하지 않는다
            // 세션 저장소를 못 쓰면 인증을 통과시키지 않는다 (fail closed)
            if (isStoreError(err)) return sendJson(503, { error: "session store unavailable" });
            return sendJson(500, { error: "internal error" });
        }
    });

    // ---- 정적 파일 ----

    async function serveStatic(req, res, urlPath) {
        if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method not allowed", { Allow: "GET, HEAD" });

        let root;
        let relative;
        if (urlPath === "/") [root, relative] = [webRoot, "index.html"];
        else if (urlPath.startsWith("/web/")) [root, relative] = [webRoot, urlPath.slice("/web/".length)];
        else if (urlPath.startsWith("/mini-react/")) [root, relative] = [miniReactRoot, urlPath.slice("/mini-react/".length)];
        else throw new HttpError(404, "not found");

        const file = await resolveInside(root, relative);
        const type = MIME_TYPES.get(path.extname(file).toLowerCase());
        if (!type) throw new HttpError(404, "not found");
        const content = await fs.readFile(file);
        res.writeHead(200, {
            "Content-Type": type,
            "Content-Length": content.length,
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            ...(type.startsWith("text/html") ? { "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'" } : {}),
        });
        res.end(req.method === "HEAD" ? undefined : content);
    }
}

const notFound = () => new HttpError(404, "not found");
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

// 요청 경로를 root 폴더 안의 실제 파일 경로로 바꾼다. root 밖으로 나가려는 모든 시도는 404.
async function resolveInside(root, relative) {
    const rawSegments = relative === "" ? [] : relative.split("/");
    const segments = [];
    for (const [i, raw] of rawSegments.entries()) {
        if (raw === "" && i === rawSegments.length - 1) continue; // 끝의 "/"는 디렉터리 요청
        let segment;
        try {
            segment = decodeURIComponent(raw); // "/"로 먼저 나눈 뒤 조각마다 디코딩해야 %2f와 %2e%2e를 걸러낼 수 있다
        } catch {
            throw notFound();
        }
        // 빈 조각, 숨김 파일과 "..", 경로 구분자(/ \), NUL, ":"(Windows 드라이브·대체 스트림), 장치 이름은 모두 거절
        if (segment === "" || segment.startsWith(".") || /[\\/\0:]/.test(segment) || WINDOWS_RESERVED_NAME.test(segment)) throw notFound();
        segments.push(segment);
    }

    let target = path.join(root, ...segments);
    try {
        let stat = await fs.stat(target);
        if (stat.isDirectory()) {
            target = path.join(target, "index.html"); // 디렉터리는 index.html이 있을 때만 제공
            stat = await fs.stat(target);
        }
        if (!stat.isFile()) throw notFound();
        // 심볼릭 링크로 root 밖을 가리키는 경우까지 막기 위해 실제 경로로 한 번 더 확인한다
        const [realTarget, realRoot] = await Promise.all([fs.realpath(target), fs.realpath(root)]);
        if (!realTarget.startsWith(realRoot + path.sep)) throw notFound();
        return realTarget;
    } catch (err) {
        throw err instanceof HttpError ? err : notFound();
    }
}

function isStoreError(err) {
    return err instanceof RedisUnavailableError || err instanceof RedisHttpError;
}

function isJson(req) {
    return (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() === "application/json";
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

// 본문 크기를 제한하는 이유: 제한이 없으면 큰 요청 하나가 서버 메모리를 다 쓸 수 있다. (미니 Redis 서버와 같은 방식)
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const tooLarge = () => new HttpError(413, "payload too large", { Connection: "close" });
        if (Number(req.headers["content-length"]) > limit) {
            req.resume();
            return reject(tooLarge());
        }
        const chunks = [];
        let size = 0;
        let rejected = false;
        req.on("data", (chunk) => {
            if (rejected) return;
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

// 시작할 때 REDIS_URL이 정말 미니 Redis인지 /health로 확인한다. 같은 포트를 다른 프로그램(예: 개발 도구)이 쓰고 있으면
// 세션 저장소 오류(503)만 보여서 원인을 찾기 어렵기 때문이다. 결과는 { ok, message }.
export async function checkMiniRedis(redisUrl, timeoutMs = 2000) {
    const url = `${redisUrl.replace(/\/+$/, "")}/health`;
    let res;
    try {
        res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
        const reason = err?.name === "TimeoutError" ? `${timeoutMs}ms 안에 응답이 없습니다` : (err?.cause?.code ?? err?.message);
        return { ok: false, message: `미니 Redis에 연결할 수 없습니다 (${redisUrl}: ${reason}). 먼저 \`npm start\`로 미니 Redis를 켜고 주소/포트를 확인하세요.` };
    }
    let body;
    try {
        body = await res.json();
    } catch {
        /* JSON이 아닌 응답 */
    }
    if (res.ok && body?.status === "ok") return { ok: true, message: "" };
    return { ok: false, message: `미니 Redis가 아닌 서버가 응답하고 있습니다 (${url} → HTTP ${res.status}). 주소/포트를 확인하세요. 다른 프로그램이 같은 포트를 쓰고 있을 수 있습니다.` };
}

function envNumber(name, fallback, { allowZero = false } = {}) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || (value === 0 && !allowZero)) throw new Error(`${name}는 ${allowZero ? "0 이상" : "양수"}여야 합니다 (받은 값: ${raw})`);
    return value;
}

async function main() {
    const port = Number(process.env.PORT ?? 4000);
    const host = process.env.HOST ?? "127.0.0.1";
    const redisUrl = process.env.REDIS_URL ?? "http://127.0.0.1:6380";

    let users;
    try {
        users = await loadUsers(path.join(DEMO_DIR, "users.json"));
    } catch {
        console.error("demo/users.json을 읽을 수 없습니다. 먼저 `npm run seed`로 테스트 계정을 만드세요.");
        process.exit(1);
    }

    let db;
    try {
        db = openDb(process.env.DEMO_DB_PATH ?? undefined);
    } catch (err) {
        if (!(err instanceof DbNotSeededError)) throw err;
        console.error(err.message);
        process.exit(1);
    }

    const server = createDemoApp({
        redisClient: new MiniRedisClient({ baseUrl: redisUrl }),
        users,
        db,
        sessionTtlMs: envNumber("SESSION_TTL_MS", 30 * 60 * 1000),
        dashboardDelayMs: envNumber("DASHBOARD_DELAY_MS", 0, { allowZero: true }),
        dashboardCacheTtlMs: envNumber("DASHBOARD_CACHE_TTL_MS", 30_000),
        logger: ({ method, path: p, status, ms, error }) => console.log(`${method} ${p} ${status} ${ms}ms`, error ?? ""),
    });
    server.once("error", (err) => {
        if (err.code !== "EADDRINUSE") throw err;
        console.error(`포트 ${port}이 이미 사용 중입니다. PORT 환경변수로 다른 포트를 지정하세요 (예: PORT=${port + 1} npm run demo)`);
        process.exit(1);
    });
    server.listen(port, host, async () => {
        console.log(`demo app listening on http://${host}:${port} (mini redis: ${redisUrl})`);
        const check = await checkMiniRedis(redisUrl);
        if (!check.ok) console.warn(`경고: ${check.message}`); // 경고만 하고 서버는 계속 켠다 (미니 Redis를 나중에 켜도 동작하도록)
    });

    let closing = false;
    const stop = (signal) => {
        if (closing) return;
        closing = true;
        console.log(`${signal} received, shutting down`);
        setTimeout(() => process.exit(1), 5000).unref();
        server.close(() => {
            db.close(); // 서버를 닫은 뒤 DB 파일도 닫는다
            process.exit(0);
        });
        server.closeIdleConnections?.();
    };
    process.on("SIGINT", () => stop("SIGINT"));
    process.on("SIGTERM", () => stop("SIGTERM"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
