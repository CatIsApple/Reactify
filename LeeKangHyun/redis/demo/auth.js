import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

const KEY_LENGTH = 64;

function scrypt(password, salt) {
    return new Promise((resolve, reject) => {
        // 비동기 scrypt: 해시를 계산하는 동안 이벤트 루프가 막혀 다른 요청이 멈추지 않게 한다
        crypto.scrypt(password, Buffer.from(salt, "hex"), KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key)));
    });
}

// 사용자마다 새 랜덤 salt를 써서, 같은 비밀번호도 서로 다른 해시가 되고 미리 계산한 표(rainbow table)가 소용없게 한다.
export async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const key = await scrypt(password, salt);
    return { salt, hash: key.toString("hex") };
}

// timingSafeEqual: 앞에서부터 비교하다 멈추는 일반 비교는 응답 시간으로 해시를 한 글자씩 알아낼 수 있어서 쓰지 않는다.
export async function verifyPassword(password, { salt, hash }) {
    const expected = Buffer.from(hash, "hex");
    const actual = await scrypt(password, salt);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// 없는 아이디에도 같은 해시 계산을 하기 위한 가짜 계정. 비교는 항상 실패한다.
export const DUMMY_CREDENTIAL = { salt: "00".repeat(16), hash: "00".repeat(KEY_LENGTH) };

// 세션 id: 추측할 수 없도록 암호학적 난수 32바이트 (hex 64자)
export function newSessionId() {
    return crypto.randomBytes(32).toString("hex");
}

export const SESSION_ID_PATTERN = /^[0-9a-f]{64}$/;

// Cookie 헤더를 직접 파싱한다. 이상한 입력에도 예외를 던지지 않고, 이름이 "__proto__"여도 안전하도록 Map을 쓴다.
export function parseCookies(header) {
    const cookies = new Map();
    if (typeof header !== "string") return cookies;
    for (const part of header.split(";")) {
        const eq = part.indexOf("=");
        if (eq < 1) continue; // 이름이 없거나 "="가 없는 조각은 무시
        const name = part.slice(0, eq).trim();
        let value = part.slice(eq + 1).trim();
        if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        try {
            value = decodeURIComponent(value);
        } catch {
            /* 잘못된 퍼센트 인코딩은 원문 그대로 둔다 */
        }
        if (name !== "" && !cookies.has(name)) cookies.set(name, value); // 같은 이름이 여러 번이면 첫 번째 값
    }
    return cookies;
}

// users.json → Map(아이디 → { salt, hash }). 객체 대신 Map이라 "__proto__" 같은 아이디도 안전하다.
export async function loadUsers(path) {
    const raw = JSON.parse(await readFile(path, "utf8"));
    return new Map(Object.entries(raw));
}
