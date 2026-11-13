// 벤치마크용 SQLite DB를 만든다: npm run seed:db
//   SEED_ROWS=300000 (기본)   DB_INDEX=off (기본) | on     DEMO_DB_PATH=<파일 경로>
// 같은 SEED_ROWS와 같은 시드면 항상 같은 데이터가 만들어진다 (재현 가능).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_DB_PATH } from "./db.js";

export const DEFAULT_ROWS = 300_000;
export const DEFAULT_SEED = 20261113;
// users.json의 계정(demo, alice)에 몇 명을 더 섞는다
export const USERNAMES = ["demo", "alice", "bob", "carol", "dave", "erin", "frank", "grace"];
export const EVENT_TYPES = ["view", "click", "purchase", "refund", "login"];

// mulberry32: 시드가 같으면 항상 같은 수열을 만드는 간단한 의사난수 생성기 (0 이상 1 미만)
export function createRng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function seedDb({ file = DEFAULT_DB_PATH, rows = DEFAULT_ROWS, index = false, seed = DEFAULT_SEED } = {}) {
    if (!Number.isInteger(rows) || rows < 0) throw new RangeError("rows는 0 이상의 정수여야 합니다");
    mkdirSync(path.dirname(file), { recursive: true });
    const started = performance.now();
    const db = new DatabaseSync(file);
    try {
        // 기존 테이블은 지우고 새로 만든다
        db.exec(`
            DROP TABLE IF EXISTS events;
            DROP TABLE IF EXISTS meta;
            CREATE TABLE events (id INTEGER PRIMARY KEY, username TEXT, type TEXT, amount INTEGER, created_at INTEGER);
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        `);
        const rng = createRng(seed);
        const insert = db.prepare("INSERT INTO events (username, type, amount, created_at) VALUES (?, ?, ?, ?)");
        const baseTime = Date.UTC(2026, 0, 1);
        // 하나의 트랜잭션으로 넣어야 행마다 디스크에 쓰지 않아서 훨씬 빠르다
        db.exec("BEGIN");
        for (let i = 0; i < rows; i++) {
            insert.run(
                USERNAMES[Math.floor(rng() * USERNAMES.length)],
                EVENT_TYPES[Math.floor(rng() * EVENT_TYPES.length)],
                Math.floor(rng() * 10_000),
                baseTime + Math.floor(rng() * 300 * 24 * 3600 * 1000),
            );
        }
        db.exec("COMMIT");
        // 인덱스는 데이터를 다 넣은 뒤에 만드는 편이 빠르다
        if (index) db.exec("CREATE INDEX idx_events_username ON events (username)");
        const putMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
        for (const [key, value] of [["rows", rows], ["indexed", index ? "on" : "off"], ["seed", seed], ["seeded_at", new Date().toISOString()]]) putMeta.run(key, String(value));
    } finally {
        db.close();
    }
    return { file, rows, indexed: index ? "on" : "off", ms: Math.round(performance.now() - started) };
}

function envInt(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name}는 0 이상의 정수여야 합니다 (받은 값: ${raw})`);
    return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const index = (process.env.DB_INDEX ?? "off").toLowerCase();
    if (index !== "on" && index !== "off") throw new Error(`DB_INDEX는 on 또는 off여야 합니다 (받은 값: ${process.env.DB_INDEX})`);
    const result = seedDb({ file: process.env.DEMO_DB_PATH ?? DEFAULT_DB_PATH, rows: envInt("SEED_ROWS", DEFAULT_ROWS), index: index === "on" });
    console.log(`${result.file}: events ${result.rows.toLocaleString("en-US")}행, username 인덱스 ${result.indexed}, ${result.ms}ms`);
}
