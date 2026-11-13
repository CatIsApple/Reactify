// 파일 이름을 *_test.js로 한 이유: node --test는 찾지만, 루트의 Vitest 기본 패턴(*.test.js)에는 잡히지 않는다.
// 진짜 SQLite(node:sqlite)를 임시 폴더에 만들어서 검증한다. 끝나면 임시 폴더를 지운다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { DbNotSeededError, openDb } from "../demo/db.js";
import { EVENT_TYPES, USERNAMES, createRng, seedDb } from "../demo/seed_db.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withTempDir(run) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mini-redis-db-"));
    try {
        await run(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

// SQL의 GROUP BY를 쓰지 않고, 모든 행을 읽어서 JS로 직접 계산한 정답
function expectedStats(file, username) {
    const raw = new DatabaseSync(file, { readOnly: true });
    try {
        const rows = raw.prepare("SELECT username, type, amount FROM events").all().filter((r) => r.username === username);
        const byType = new Map();
        for (const r of rows) {
            const entry = byType.get(r.type) ?? { type: r.type, count: 0, total: 0 };
            entry.count++;
            entry.total += r.amount;
            byType.set(r.type, entry);
        }
        return {
            username,
            totalEvents: rows.length,
            totalAmount: rows.reduce((sum, r) => sum + r.amount, 0),
            byType: [...byType.values()].sort((a, b) => (a.type < b.type ? -1 : 1)),
        };
    } finally {
        raw.close();
    }
}

function run(script, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script], { cwd: ROOT, env: { ...process.env, ...env } });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`시간 초과\n${stdout}\n${stderr}`));
        }, 20_000);
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.on("exit", (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        });
    });
}

test("통계 쿼리 결과가 JS로 직접 계산한 값과 같다 (모든 사용자, 없는 사용자 포함)", () =>
    withTempDir(async (dir) => {
        const file = path.join(dir, "demo.db");
        seedDb({ file, rows: 3000 });
        const db = openDb(file);
        try {
            for (const username of [...USERNAMES, "nobody"]) assert.deepEqual(db.getDashboardStats(username), expectedStats(file, username), username);
            assert.equal(db.getDashboardStats("nobody").totalEvents, 0);
            assert.deepEqual(db.getDashboardStats("nobody").byType, []);
            const all = USERNAMES.reduce((sum, u) => sum + db.getDashboardStats(u).totalEvents, 0);
            assert.equal(all, 3000); // 모든 행이 어느 사용자에게든 속한다
        } finally {
            db.close();
        }
    }));

test("시드: 행 수, 테이블 구조, 메타 정보", () =>
    withTempDir(async (dir) => {
        const file = path.join(dir, "demo.db");
        const result = seedDb({ file, rows: 1234 });
        assert.equal(result.rows, 1234);
        assert.equal(result.indexed, "off");
        assert.ok(result.ms >= 0);

        const raw = new DatabaseSync(file, { readOnly: true });
        try {
            assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1234);
            const columns = raw.prepare("PRAGMA table_info(events)").all().map((c) => `${c.name}:${c.type}`);
            assert.deepEqual(columns, ["id:INTEGER", "username:TEXT", "type:TEXT", "amount:INTEGER", "created_at:INTEGER"]);
            const types = raw.prepare("SELECT DISTINCT type FROM events ORDER BY type").all().map((r) => r.type);
            assert.deepEqual(types, [...EVENT_TYPES].sort());
        } finally {
            raw.close();
        }

        const db = openDb(file);
        try {
            const info = db.info();
            assert.equal(info.rows, 1234);
            assert.equal(info.indexed, "off");
            assert.match(info.seededAt, /^\d{4}-\d{2}-\d{2}T/);
        } finally {
            db.close();
        }
    }));

test("DB_INDEX: 인덱스를 만들면 메타에 on으로 남고, 결과는 인덱스 없이 만든 것과 같다", () =>
    withTempDir(async (dir) => {
        const off = path.join(dir, "off.db");
        const on = path.join(dir, "on.db");
        seedDb({ file: off, rows: 2000, index: false });
        const resultOn = seedDb({ file: on, rows: 2000, index: true });
        assert.equal(resultOn.indexed, "on");

        for (const [file, expected] of [[off, 0], [on, 1]]) {
            const raw = new DatabaseSync(file, { readOnly: true });
            try {
                const indexes = raw.prepare("PRAGMA index_list(events)").all().filter((i) => i.name === "idx_events_username");
                assert.equal(indexes.length, expected, file);
            } finally {
                raw.close();
            }
        }
        const dbOff = openDb(off);
        const dbOn = openDb(on);
        try {
            assert.equal(dbOff.info().indexed, "off");
            assert.equal(dbOn.info().indexed, "on");
            for (const u of USERNAMES) assert.deepEqual(dbOn.getDashboardStats(u), dbOff.getDashboardStats(u)); // 인덱스는 속도만 바꾼다
        } finally {
            dbOff.close();
            dbOn.close();
        }
    }));

test("시드는 재현 가능하다: 같은 시드는 같은 데이터, 다른 시드는 다른 데이터, 다시 시드하면 기존 테이블을 대체한다", () =>
    withTempDir(async (dir) => {
        const a = path.join(dir, "a.db");
        const b = path.join(dir, "b.db");
        const c = path.join(dir, "c.db");
        seedDb({ file: a, rows: 1500, seed: 7 });
        seedDb({ file: b, rows: 1500, seed: 7 });
        seedDb({ file: c, rows: 1500, seed: 8 });
        const [dbA, dbB, dbC] = [openDb(a), openDb(b), openDb(c)];
        try {
            assert.deepEqual(dbA.getDashboardStats("demo"), dbB.getDashboardStats("demo"));
            assert.notDeepEqual(dbA.getDashboardStats("demo"), dbC.getDashboardStats("demo"));
        } finally {
            dbA.close();
            dbB.close();
            dbC.close();
        }
        seedDb({ file: a, rows: 100, seed: 7 }); // 같은 파일에 다시 시드
        const again = openDb(a);
        try {
            assert.equal(again.info().rows, 100);
            assert.equal(USERNAMES.reduce((sum, u) => sum + again.getDashboardStats(u).totalEvents, 0), 100);
        } finally {
            again.close();
        }
    }));

test("createRng: 같은 시드는 같은 수열, 값은 [0, 1)", () => {
    const x = createRng(42);
    const y = createRng(42);
    const seq = Array.from({ length: 1000 }, () => x());
    assert.deepEqual(seq, Array.from({ length: 1000 }, () => y()));
    assert.ok(seq.every((v) => v >= 0 && v < 1));
    assert.notDeepEqual(seq.slice(0, 10), Array.from({ length: 10 }, createRng(43)));
    assert.ok(new Set(seq).size > 990); // 거의 겹치지 않는다
});

test("SQL 인젝션: 위험한 문자열을 username으로 줘도 값으로만 취급되고 테이블은 그대로다", () =>
    withTempDir(async (dir) => {
        const file = path.join(dir, "demo.db");
        seedDb({ file, rows: 1000 });
        const db = openDb(file);
        try {
            const before = db.getDashboardStats("demo");
            for (const evil of ["demo' OR '1'='1", "' OR 1=1 --", "'; DROP TABLE events; --", 'demo" OR ""="', "demo%", "d_mo", "%", "demo\u0000", "demo; SELECT * FROM meta"]) {
                const stats = db.getDashboardStats(evil);
                assert.equal(stats.totalEvents, 0, evil);
                assert.deepEqual(stats.byType, [], evil);
                assert.equal(stats.username, evil);
            }
            assert.deepEqual(db.getDashboardStats("demo"), before); // 아무것도 바뀌지 않았다
            assert.equal(db.info().rows, 1000);
        } finally {
            db.close();
        }
        const raw = new DatabaseSync(file, { readOnly: true });
        try {
            assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1000); // 테이블이 살아 있다
        } finally {
            raw.close();
        }
    }));

test("시드가 안 된 DB: 파일이 없으면 안내 에러를 던지고 빈 파일을 만들지 않는다", () =>
    withTempDir(async (dir) => {
        const file = path.join(dir, "missing.db");
        assert.throws(() => openDb(file), (err) => err instanceof DbNotSeededError && err.message.includes("npm run seed:db"));
        assert.equal(existsSync(file), false);
    }));

test("시드가 안 된 DB: 테이블이 없는 빈 SQLite 파일도 같은 안내 에러", () =>
    withTempDir(async (dir) => {
        const file = path.join(dir, "empty.db");
        const raw = new DatabaseSync(file);
        raw.exec("CREATE TABLE unrelated (x INTEGER)");
        raw.close();
        assert.throws(() => openDb(file), (err) => err instanceof DbNotSeededError && err.message.includes("npm run seed:db"));

        const junk = path.join(dir, "junk.db");
        writeFileSync(junk, "이건 SQLite 파일이 아니다".repeat(50));
        assert.throws(() => openDb(junk), (err) => err instanceof DbNotSeededError || /database/i.test(err.message));
    }));

test("seedDb: 잘못된 행 수는 RangeError", () =>
    withTempDir(async (dir) => {
        for (const rows of [-1, 1.5, "10", NaN]) assert.throws(() => seedDb({ file: path.join(dir, "x.db"), rows }), RangeError, String(rows));
        assert.equal(seedDb({ file: path.join(dir, "zero.db"), rows: 0 }).rows, 0); // 0행도 허용
    }));

test("seed_db 스크립트: SEED_ROWS와 DB_INDEX 환경변수를 읽고 행 수와 소요 시간을 출력한다", () =>
    withTempDir(async (dir) => {
        const file = path.join(dir, "cli.db");
        const ok = await run("demo/seed_db.js", { DEMO_DB_PATH: file, SEED_ROWS: "500", DB_INDEX: "on" });
        assert.equal(ok.code, 0, ok.stderr);
        assert.match(ok.stdout, /500행/);
        assert.match(ok.stdout, /인덱스 on/);
        assert.match(ok.stdout, /\d+ms/);
        const db = openDb(file);
        try {
            assert.equal(db.info().rows, 500);
            assert.equal(db.info().indexed, "on");
        } finally {
            db.close();
        }
        const bad = await run("demo/seed_db.js", { DEMO_DB_PATH: path.join(dir, "bad.db"), DB_INDEX: "maybe" });
        assert.notEqual(bad.code, 0);
        assert.match(bad.stderr, /DB_INDEX/);
    }));

test("데모 앱: DB가 준비되지 않았으면 `npm run seed:db` 안내를 출력하고 종료 코드 1", () =>
    withTempDir(async (dir) => {
        const res = await run("demo/server.js", { PORT: "0", DEMO_DB_PATH: path.join(dir, "nope.db") });
        assert.equal(res.code, 1);
        assert.match(res.stderr, /npm run seed:db/);
        assert.ok(!/\n\s+at /.test(res.stderr), `스택 트레이스가 없어야 한다:\n${res.stderr}`);
        assert.ok(!res.stdout.includes("listening"));
        assert.equal(existsSync(path.join(dir, "nope.db")), false);
    }));
