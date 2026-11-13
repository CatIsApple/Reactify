// 미니 React로 만든 로그인 데모 화면. 상태와 Hook은 루트 App에서만 쓰고, 자식 컴포넌트는 props만 받는 순수 함수다.
import { FunctionComponent } from "/mini-react/component/function_component.js";
import { useState } from "/mini-react/hooks/use_state.js";
import { useEffect } from "/mini-react/hooks/use_effect.js";
import { summarize } from "/web/stats.js";

// VNode 생성 도우미: 자식 배열을 펼치고 null/false는 버린다
const h = (type, props = {}, ...children) => ({ type, props, children: children.flat().filter((c) => c != null && c !== false) });

// 브라우저는 이 앱 서버(/api/*)만 호출한다. 미니 Redis는 직접 호출하지 않는다 (세션 탈취 방지).
async function api(method, path, body) {
    const res = await fetch(path, {
        method,
        // 서버는 상태를 바꾸는 POST를 application/json으로만 받는다
        headers: method === "POST" ? { "Content-Type": "application/json" } : {},
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
    let json = null;
    try {
        json = await res.json();
    } catch {
        /* JSON이 아닌 응답 */
    }
    return { status: res.status, ok: res.ok, json, headers: res.headers };
}

const formatRemaining = (ms) => {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
};

// ---- 자식 컴포넌트: props만 받는 순수 함수 ----

export function LoginForm({ username, password, busy, error, onUsername, onPassword, onSubmit }) {
    return h(
        "form",
        { class: "card", onSubmit },
        h("h2", {}, "로그인"),
        h("div", { class: "field" }, h("label", { for: "username" }, "아이디"), h("input", { id: "username", type: "text", autocomplete: "username", value: username, required: true, onInput: onUsername })),
        h("div", { class: "field" }, h("label", { for: "password" }, "비밀번호"), h("input", { id: "password", type: "password", autocomplete: "current-password", value: password, required: true, onInput: onPassword })),
        h("p", { class: "error", role: "alert" }, error), // 항상 같은 자리에 두고 글자만 바꾼다
        h("button", { type: "submit", disabled: busy }, busy ? "로그인 중…" : "로그인"),
        h("p", { class: "muted" }, "데모 계정: demo / demo1234 (로컬 테스트용 값)")
    );
}

export function Welcome({ username, remaining, onLogout }) {
    return h(
        "section",
        { class: "card" },
        h("h2", {}, `${username}님, 환영합니다`),
        h("p", { class: "muted" }, "세션 남은 시간 ", h("span", { class: "countdown" }, remaining)),
        h("div", { class: "row" }, h("button", { type: "button", class: "secondary", onClick: onLogout }, "로그아웃"))
    );
}

const SOURCES = [
    ["db", "DBMS 직접 (SQLite)"],
    ["redis", "Redis 캐시 + DBMS"],
];

const fmt = (ms) => (ms === null || ms === undefined ? "-" : `${ms.toFixed(2)}ms`);

export function BenchResult({ bench }) {
    if (!bench) return h("div", { class: "bench" });
    const slowest = Math.max(...bench.rows.map((r) => r.mean));
    return h(
        "div",
        { class: "bench" },
        h(
            "table",
            { class: "bench-table" },
            h("thead", {}, h("tr", {}, ["구분", "평균", "중앙값", "p95", "횟수", "비교"].map((t) => h("th", {}, t)))),
            h(
                "tbody",
                {},
                bench.rows.map((r) =>
                    h(
                        "tr",
                        {},
                        h("td", {}, r.label),
                        h("td", {}, fmt(r.mean)),
                        h("td", {}, fmt(r.p50)),
                        h("td", {}, fmt(r.p95)),
                        h("td", {}, String(r.count)),
                        // 막대: CSP가 인라인 style을 막아서 width 대신 <meter>(값/최댓값)로 그린다
                        h("td", {}, h("meter", { min: 0, max: slowest, value: r.mean, "aria-label": `${r.label} 평균 ${fmt(r.mean)}` }))
                    )
                )
            )
        ),
        h("p", { class: "muted" }, `브라우저에서 잰 참고용 수치입니다 (요청 왕복 시간, ${bench.n}회). 공식 수치는 명령줄의 npm run bench로만 잽니다.`)
    );
}

export function DashboardPanel({ source, busy, benchRunning, progress, bench, result, history, message, onSource, onLoad, onClear, onBench }) {
    return h(
        "section",
        { class: "card" },
        h("h2", {}, "대시보드 (진짜 SQL 조회 + Redis 캐시)"),
        h("div", { class: "field" }, h("span", { id: "source-label", class: "label" }, "데이터 출처")),
        h(
            "div",
            { class: "segmented", role: "radiogroup", "aria-labelledby": "source-label" },
            SOURCES.map(([value, label]) => h("button", { type: "button", role: "radio", "aria-checked": String(source === value), class: source === value ? "active" : undefined, onClick: () => onSource(value) }, label))
        ),
        h("p", { class: "muted" }, "Redis 캐시 모드에서도 캐시에 값이 없으면 DBMS를 읽습니다. DBMS 직접 모드는 매번 SQL을 실행합니다."),
        h(
            "div",
            { class: "row" },
            h("button", { type: "button", disabled: busy || benchRunning, onClick: onLoad }, busy ? "불러오는 중…" : "대시보드 불러오기"),
            h("button", { type: "button", class: "secondary", disabled: benchRunning, onClick: onClear }, "캐시 지우기"),
            h("button", { type: "button", class: "secondary", disabled: benchRunning || busy, onClick: onBench }, benchRunning ? "측정 중…" : "벤치마크 실행")
        ),
        h("p", { class: "result" }, result),
        h("p", { class: "muted", role: "status" }, benchRunning ? progress : message),
        BenchResult({ bench }),
        h("h2", {}, "최근 응답 시간"),
        h("ol", { class: "history" }, history.map((line) => h("li", {}, line)))
    );
}

// ---- 루트 컴포넌트: 모든 State와 Hook은 여기서만 쓴다 ----

export function App() {
    const [status, setStatus] = useState("loading"); // loading | anonymous | authenticated
    const [loginName, setLoginName] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [username, setUsername] = useState("");
    const [ttlMs, setTtlMs] = useState(0);
    const [expiresAt, setExpiresAt] = useState(0);
    const [now, setNow] = useState(Date.now());
    const [source, setSource] = useState("redis"); // 데이터 출처: db | redis
    const [benchRunning, setBenchRunning] = useState(false);
    const [progress, setProgress] = useState("");
    const [bench, setBench] = useState(null);
    const [result, setResult] = useState("아직 불러오지 않았습니다.");
    const [history, setHistory] = useState([]);
    const [dashBusy, setDashBusy] = useState(false);
    const [dashMessage, setDashMessage] = useState("");

    const startSession = (me) => {
        setUsername(me.username);
        setTtlMs(me.expiresInMs);
        setExpiresAt(Date.now() + me.expiresInMs);
        setNow(Date.now());
        setStatus("authenticated");
    };
    const endSession = (text) => {
        setStatus("anonymous");
        setNotice(text);
        setResult("아직 불러오지 않았습니다.");
        setHistory([]);
        setDashMessage("");
        setBench(null);
    };

    // 처음 로드할 때 서버에 세션이 남아 있는지 확인해 로그인 상태를 복구한다
    useEffect(() => {
        api("GET", "/api/me")
            .then((r) => (r.ok ? startSession(r.json) : setStatus("anonymous")))
            .catch(() => {
                setError("서버에 연결할 수 없습니다.");
                setStatus("anonymous");
            });
    }, []);

    // 로그인 중에만 1초 타이머를 돌리고, 화면을 떠나면 cleanup으로 정리한다
    useEffect(() => {
        if (status !== "authenticated") return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [status]);

    // 남은 시간이 0이 되면 서버에 확인한다: 아직 살아 있으면 시간을 다시 맞추고, 401이면 만료 안내
    const expired = status === "authenticated" && now >= expiresAt;
    useEffect(() => {
        if (!expired) return;
        api("GET", "/api/me")
            .then((r) => (r.ok ? startSession(r.json) : endSession("세션이 만료되었습니다. 다시 로그인하세요.")))
            .catch(() => endSession("서버에 연결할 수 없어 로그아웃되었습니다."));
    }, [expired]);

    const submit = async (e) => {
        e.preventDefault(); // 폼 기본 동작(페이지 이동)을 막는다
        if (busy) return;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const r = await api("POST", "/api/login", { username: loginName, password: loginPassword });
            if (r.ok) {
                const me = await api("GET", "/api/me");
                setLoginPassword("");
                if (me.ok) startSession(me.json);
                else setError("로그인 상태를 확인하지 못했습니다.");
            } else if (r.status === 429) setError(`로그인 시도가 너무 많습니다. ${r.headers.get("Retry-After")}초 뒤에 다시 시도하세요.`);
            else if (r.status === 401) setError("아이디 또는 비밀번호가 올바르지 않습니다.");
            else if (r.status === 503) setError("세션 저장소를 사용할 수 없습니다. 잠시 뒤 다시 시도하세요.");
            else setError("로그인에 실패했습니다.");
        } catch {
            setError("서버에 연결할 수 없습니다.");
        }
        setBusy(false);
    };

    const logout = async () => {
        await api("POST", "/api/logout").catch(() => {});
        setLoginName("");
        endSession("로그아웃했습니다.");
    };

    const loadDashboard = async () => {
        setDashBusy(true);
        setDashMessage("");
        try {
            const r = await api("GET", `/api/dashboard?mode=${source}`);
            if (r.status === 401) return endSession("세션이 만료되었습니다. 다시 로그인하세요.");
            if (!r.ok) return setDashMessage("대시보드를 불러오지 못했습니다.");
            const { elapsedMs, data } = r.json;
            const cache = r.headers.get("X-Cache");
            const label = cache === "HIT" ? "Redis 캐시 HIT" : cache === "MISS" ? "DBMS 조회 (캐시 MISS, 결과를 Redis에 저장)" : "DBMS 직접 조회";
            setResult(`${label}: ${elapsedMs}ms. 이벤트 ${data.totalEvents.toLocaleString()}건, 금액 합계 ${data.totalAmount.toLocaleString()}`);
            setHistory([...history, `${label} ${elapsedMs}ms`].slice(-6));
            setExpiresAt(Date.now() + ttlMs); // 서버가 요청마다 세션 만료 시간을 늘리므로 화면의 남은 시간도 다시 맞춘다
        } catch {
            setDashMessage("서버에 연결할 수 없습니다.");
        } finally {
            setDashBusy(false);
        }
    };

    // 브라우저에서 두 방식을 순서대로 N번씩 불러 평균·중앙값·p95를 낸다 (참고용)
    const runBench = async () => {
        const N = 30;
        setBenchRunning(true);
        setBench(null);
        setDashMessage("");
        const timed = async (path) => {
            const t0 = performance.now();
            const r = await api("GET", path);
            const ms = performance.now() - t0;
            if (r.status === 401) throw new Error("expired");
            if (!r.ok) throw new Error("failed");
            return { ms, cache: r.headers.get("X-Cache") };
        };
        try {
            setProgress("DBMS 직접: 워밍업 1회 (결과에서 제외)");
            await timed("/api/dashboard?mode=db");
            const dbSamples = [];
            for (let i = 0; i < N; i++) {
                setProgress(`DBMS 직접: ${i + 1}/${N}`);
                dbSamples.push((await timed("/api/dashboard?mode=db")).ms);
            }
            await api("DELETE", "/api/dashboard/cache"); // 첫 호출이 MISS가 되도록 캐시를 한 번 지운다
            setProgress("Redis 캐시: MISS 1회");
            const miss = await timed("/api/dashboard?mode=redis");
            const hitSamples = [];
            for (let i = 0; i < N; i++) {
                setProgress(`Redis 캐시 HIT: ${i + 1}/${N}`);
                const r = await timed("/api/dashboard?mode=redis");
                if (r.cache === "HIT") hitSamples.push(r.ms);
            }
            const row = (label, samples) => ({ label, ...summarize(samples) });
            setBench({ n: N, rows: [row("DBMS 직접 (SQLite)", dbSamples), row("Redis 캐시 MISS (DBMS + 저장)", [miss.ms]), row("Redis 캐시 HIT", hitSamples)] });
            setExpiresAt(Date.now() + ttlMs);
        } catch (err) {
            if (err.message === "expired") endSession("세션이 만료되었습니다. 다시 로그인하세요.");
            else setDashMessage("벤치마크를 끝내지 못했습니다.");
        }
        setProgress("");
        setBenchRunning(false);
    };

    const clearCache = async () => {
        const r = await api("DELETE", "/api/dashboard/cache").catch(() => null);
        if (r?.status === 401) return endSession("세션이 만료되었습니다. 다시 로그인하세요.");
        setDashMessage(r?.ok ? (r.json.deleted ? "캐시를 지웠습니다. 다음 요청은 원본을 다시 조회합니다." : "지울 캐시가 없습니다.") : "캐시를 지우지 못했습니다.");
    };

    const screen =
        status === "loading"
            ? h("section", { class: "card" }, h("p", { class: "muted" }, "세션을 확인하는 중…"))
            : status === "anonymous"
              ? LoginForm({ username: loginName, password: loginPassword, busy, error, onUsername: (e) => setLoginName(e.target.value), onPassword: (e) => setLoginPassword(e.target.value), onSubmit: submit })
              : h(
                    "div",
                    { class: "stack" },
                    Welcome({ username, remaining: formatRemaining(expiresAt - now), onLogout: logout }),
                    DashboardPanel({ source, busy: dashBusy, benchRunning, progress, bench, result, history, message: dashMessage, onSource: setSource, onLoad: loadDashboard, onClear: clearCache, onBench: runBench })
                );

    return h("main", { class: "app" }, h("h1", {}, "미니 Redis 로그인 데모"), h("p", { class: "notice", role: "status" }, notice), screen);
}

new FunctionComponent(App).mount(document.getElementById("root"));
