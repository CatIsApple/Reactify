// 로컬 데모용 테스트 계정을 만든다: node demo/seed_users.js (또는 npm run seed)
// 아래 비밀번호는 데모용 테스트 값이다. 실제 비밀번호를 쓰지 않는다.
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashPassword } from "./auth.js";

const TEST_ACCOUNTS = [
    ["demo", "demo1234"],
    ["alice", "alice1234"],
];

export async function seedUsers(path) {
    const users = {};
    for (const [username, password] of TEST_ACCOUNTS) users[username] = await hashPassword(password); // 평문은 저장하지 않는다
    await writeFile(path, `${JSON.stringify(users, null, 2)}\n`);
    return Object.keys(users);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const path = fileURLToPath(new URL("./users.json", import.meta.url));
    const names = await seedUsers(path);
    console.log(`테스트 계정 ${names.join(", ")} 을(를) ${path} 에 만들었습니다 (비밀번호는 scrypt 해시로만 저장)`);
}
