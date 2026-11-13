// 대시보드의 "원본" 데이터 계층: Node 내장 node:sqlite(SQLite, 디스크 파일 기반 SQL DBMS)를 쓴다.
// getDashboardStats가 데이터 출처의 경계라서, 나중에 다른 DBMS(예: 직접 만든 미니 DBMS)로 바꿀 때 이 함수만 같은 모양으로 구현하면 된다.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "demo.db");

// 시드가 안 된 DB를 열려고 할 때 던지는 에러. message가 그대로 사용자에게 보여 줄 안내문이다.
export class DbNotSeededError extends Error {
    constructor(file) {
        super(`데모 DB가 준비되지 않았습니다 (${file}). \`npm run seed:db\`를 먼저 실행하세요.`);
        this.name = "DbNotSeededError";
    }
}

export function openDb(file = DEFAULT_DB_PATH) {
    // 파일이 없을 때 DatabaseSync를 열면 빈 DB 파일이 새로 만들어지므로, 먼저 존재를 확인한다
    if (!existsSync(file)) throw new DbNotSeededError(file);
    const db = new DatabaseSync(file, { readOnly: true }); // 앱은 읽기만 하므로 읽기 전용으로 연다
    try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('events', 'meta')").all();
        if (tables.length !== 2) throw new DbNotSeededError(file);
    } catch (err) {
        db.close();
        throw err instanceof DbNotSeededError ? err : new DbNotSeededError(file);
    }

    // 모든 SQL은 prepared statement로 만들고 값은 ? 자리에 바인딩한다 (문자열을 이어 붙이지 않는다)
    const statsQuery = db.prepare("SELECT type, COUNT(*) AS cnt, SUM(amount) AS total FROM events WHERE username = ? GROUP BY type ORDER BY type");
    const metaQuery = db.prepare("SELECT key, value FROM meta");

    return {
        // 사용자별 통계. 같은 DB와 같은 사용자면 항상 같은 값을 돌려준다 (캐시와 직접 조회가 같은 내용이어야 하므로 시각 같은 값은 넣지 않는다)
        getDashboardStats(username) {
            const rows = statsQuery.all(username);
            return {
                username,
                totalEvents: rows.reduce((sum, r) => sum + r.cnt, 0),
                totalAmount: rows.reduce((sum, r) => sum + r.total, 0),
                byType: rows.map((r) => ({ type: r.type, count: r.cnt, total: r.total })),
            };
        },
        // 시드할 때 남긴 정보 { rows, indexed ("on" | "off"), seed, seededAt }
        info() {
            const meta = Object.fromEntries(metaQuery.all().map((r) => [r.key, r.value]));
            return { rows: Number(meta.rows), indexed: meta.indexed, seed: Number(meta.seed), seededAt: meta.seeded_at };
        },
        close() {
            db.close();
        },
    };
}
