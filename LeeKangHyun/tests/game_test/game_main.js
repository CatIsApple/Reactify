import { FunctionComponent } from "../../src/component/function_component.js";
import { diff } from "../../src/diff/diff.js";
import { patch } from "../../src/patch/patch.js";
import { App, HOOK_NAMES } from "./game_app.js";
import { countNodes, changedKeys, meaningfulPatches, treeLines, explainPath, patchChanges, hookRows } from "./inspector.js";

const panelBody = document.getElementById("panel-body");
const panel = document.getElementById("panel");
const toggleBtn = document.getElementById("toggle-panel");

const MAX_RECORDS = 60;
// 패널 기록은 패널이 닫혀 있어도 계속 쌓는다
const records = [];
let selectedId = null;
let prevRows = [];
let nextId = 0;

let hits = [];
let hitTimer = null;

// path가 가리키는 실제 DOM 노드 (patch.js의 find는 export되지 않아 따로 구현)
function findDom(root, path) {
    let node = root;
    for (const i of path) node = node?.childNodes[i];
    return node;
}

function clearHighlight() {
    clearTimeout(hitTimer);
    hits.forEach((el) => el.classList.remove("dom-hit"));
    hits = [];
}

// 하이라이트는 DOM에만 붙였다 떼는 임시 class라 VNode(다음 diff)에는 영향을 주지 않는다
function highlight(dom, patches) {
    clearHighlight();
    for (const p of meaningfulPatches(patches)) {
        const node = findDom(dom, p.op === "REMOVE" ? p.path.slice(0, -1) : p.path);
        const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (!el || !el.classList || hits.includes(el)) continue;
        void el.offsetWidth; // 연속 업데이트에서도 애니메이션이 다시 시작되게 한다
        el.classList.add("dom-hit");
        hits.push(el);
    }
    hitTimer = setTimeout(clearHighlight, 600);
}

function addRecord(rec) {
    rec.id = nextId++;
    records.push(rec);
    if (records.length > MAX_RECORDS) records.shift();
    selectedId = rec.id;
    renderPanel();
}

// FunctionComponent를 수정하지 않고 update()만 재정의해서 단계별 정보를 가로챈다
class InspectedComponent extends FunctionComponent {
    update() {
        if (!this.oldVNode) throw new Error("InspectedComponent: mount 전에는 update()할 수 없습니다");
        const before = this.oldVNode;
        const after = this.render(); // ② render
        const pending = this.pendingEffects.length;
        const patches = diff(before, after); // ③ diff
        this.dom = patch(this.dom, patches); // ④ patch
        this.oldVNode = after;
        this.report(before, after, patches, pending);
        this.runEffects(); // ⑤ effect
    }

    report(before, after, patches, pending) {
        const real = meaningfulPatches(patches);
        const rows = hookRows(this.hooks, HOOK_NAMES, prevRows);
        prevRows = rows;
        const causes = rows.filter((r) => r.changed && r.kind !== "useEffect").map((r) => `${r.name}: ${r.from} → ${r.text}`);
        const changedCount = new Set(real.map((p) => p.path.join(","))).size;
        const total = countNodes(after);
        const handlerOnly = patches.length - real.length;
        const reran = rows.filter((r) => r.kind === "useMemo" && r.changed).map((r) => r.name);

        addRecord({
            title: real.length ? causes.join(", ") : `${causes.join(", ")} (화면 변화 없음)`,
            changedCount,
            total,
            patchTotal: patches.length,
            handlerOnly,
            steps: [
                { name: "setState", detail: causes.length ? `상태가 바뀌었습니다: ${causes.join(", ")}` : "상태 값이 바뀌었습니다" },
                {
                    name: "render()",
                    detail: `App 함수를 다시 실행했습니다. 훅 ${this.hookIndex}개를 hooks[0]부터 순서대로 읽어 새 VNode(${total}개 노드)를 만들었습니다.` +
                        (reran.length ? ` useMemo가 다시 계산됨: ${reran.join(", ")}.` : " useMemo는 deps가 같아 이전 값을 그대로 썼습니다."),
                },
                {
                    name: "diff",
                    detail: `이전 VNode와 새 VNode를 같은 위치끼리 비교해 패치 ${patches.length}개를 만들었습니다.` +
                        (handlerOnly ? ` 이 중 클릭 핸들러(함수)만 새로 바뀐 ${handlerOnly}개는 화면과 무관해 아래 목록에서 뺐고, 실제 변경은 ${real.length}개입니다.` : ""),
                },
                {
                    name: "patch",
                    detail: real.length
                        ? `실제 DOM에서 노드 ${changedCount}개만 고쳤습니다. 나머지 ${total - changedCount}개는 손대지 않아 같은 객체 그대로입니다.`
                        : "고칠 DOM이 없습니다. 핸들러 교체만 처리했습니다.",
                },
                { name: "effect", detail: pending ? `deps가 바뀐 effect ${pending}개를 DOM 반영 뒤에 실행합니다.` : "실행할 effect가 없습니다 (deps 변화 없음)." },
            ],
            cards: real.map((p) => ({
                op: p.op,
                path: p.path,
                where: p.op === "CREATE" ? `${explainPath(after, p.path.slice(0, -1))} 의 ${p.path.at(-1)}번째 자리` : explainPath(before, p.path),
                changes: patchChanges(p, before),
            })),
            rows,
            tree: treeLines(after, changedKeys(patches)),
        });
        highlight(this.dom, patches);
    }
}

// textContent만 사용해 값이 HTML로 해석되지 않게 한다
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function section(title, hint, open = true) {
    const box = document.createElement("details");
    box.open = open;
    const head = el("summary", "sec-title", title);
    if (hint) head.append(el("span", "sec-hint", hint));
    const body = el("div", "sec-body");
    box.append(head, body);
    return { box, body };
}

const show = (v) => (v === undefined ? "(없음)" : String(v));

function renderPanel() {
    panelBody.replaceChildren();
    const rec = records.find((r) => r.id === selectedId);
    if (!rec) return;

    // 기록 고르기
    const pick = el("label", "pick", "업데이트 기록 ");
    const select = document.createElement("select");
    records.forEach((r) => {
        const opt = el("option", "", `#${r.id} · ${r.title}`);
        opt.value = r.id;
        opt.selected = r.id === selectedId;
        select.append(opt);
    });
    select.addEventListener("change", () => {
        selectedId = Number(select.value);
        renderPanel();
    });
    pick.append(select);
    panelBody.append(pick);

    // 한눈에 보기
    const cards = el("div", "stat-cards");
    const stat = (big, small) => {
        const c = el("div", "stat-card");
        c.append(el("div", "big", big), el("div", "small", small));
        cards.append(c);
    };
    if (rec.kind === "mount") {
        stat(String(rec.total), "처음 그린 전체 노드");
        stat("0", "패치 (처음엔 비교할 이전 화면이 없음)");
        stat(String(records.length), "지금까지 기록");
    } else {
        stat(`${rec.changedCount} / ${rec.total}`, "이번에 바뀐 노드 / 전체 노드");
        stat(String(rec.patchTotal - rec.handlerOnly), `화면에 영향 있는 패치 (핸들러만 바뀐 ${rec.handlerOnly}개 제외)`);
        stat(String(records.length), "지금까지 기록");
    }
    panelBody.append(cards);

    // 1. 단계별 과정
    const flow = section("1. 이번 업데이트는 이렇게 진행됐습니다", "setState → render → diff → patch → effect");
    const ol = el("ol", "steps");
    rec.steps.forEach((s) => {
        const li = el("li", "");
        li.append(el("b", "", s.name), el("span", "", s.detail));
        ol.append(li);
    });
    flow.body.append(ol);
    panelBody.append(flow.box);

    // 2. 패치
    const pat = section("2. diff 가 만든 패치", "무엇을, 어디에, 어떻게 고치는지");
    if (rec.cards.length === 0) pat.body.append(el("p", "muted", "화면을 고칠 패치가 없습니다."));
    rec.cards.forEach((c) => {
        const card = el("div", "pcard");
        const head = el("div", "phead");
        head.append(el("span", `op ${c.op}`, c.op), el("span", "path", `path [${c.path.join(",")}]`));
        card.append(head, el("div", "where", c.where));
        const list = el("ul", "changes");
        c.changes.forEach((ch) => {
            const li = el("li", "");
            li.append(el("span", "lbl", ch.label));
            if (ch.from !== undefined) li.append(el("del", "", show(ch.from)));
            if (ch.from !== undefined && ch.to !== undefined) li.append(el("span", "arrow", "→"));
            if (ch.to !== undefined) li.append(el("ins", "", show(ch.to)));
            list.append(li);
        });
        card.append(list);
        pat.body.append(card);
    });
    panelBody.append(pat.box);

    // 3. State / hooks
    const st = section("3. State (hooks 배열)", "노란 칸이 이번에 바뀐 값");
    st.body.append(el("p", "muted", "App 함수가 다시 실행돼도 값이 남는 이유: 값은 함수 안이 아니라 컴포넌트의 hooks 배열 칸에 저장되고, 훅을 부른 순서가 곧 칸 번호입니다."));
    const table = el("table", "hooks");
    const thead = el("tr", "");
    ["칸", "이름", "종류", "현재 값"].forEach((t) => thead.append(el("th", "", t)));
    table.append(thead);
    rec.rows.forEach((r) => {
        const tr = el("tr", r.changed ? "chg" : "");
        tr.append(el("td", "mono", `hooks[${r.index}]`), el("td", "", r.name), el("td", "mono", r.kind));
        const val = el("td", "mono");
        if (r.changed) val.append(el("del", "", r.from), el("span", "arrow", "→"), el("ins", "", r.text));
        else val.append(document.createTextNode(r.text));
        if (r.extra) val.append(el("div", "muted", r.extra));
        tr.append(val);
        table.append(tr);
    });
    const wrap = el("div", "scroll");
    wrap.append(table);
    st.body.append(wrap);
    panelBody.append(st.box);

    // 4. 트리
    const tr = section("4. 이 시점의 VNode 트리", "노란 줄이 이번에 바뀐 노드", false);
    const pre = el("pre", "tree");
    rec.tree.forEach((line) => pre.append(el("span", line.changed ? "changed" : "", `${line.text}\n`)));
    tr.body.append(pre);
    panelBody.append(tr.box);
}

toggleBtn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggleBtn.setAttribute("aria-expanded", String(!panel.hidden));
});

const component = new InspectedComponent(App);
component.mount(document.getElementById("game-root"));
{
    const rows = hookRows(component.hooks, HOOK_NAMES);
    prevRows = rows;
    const total = countNodes(component.oldVNode);
    addRecord({
        kind: "mount",
        title: "처음 그리기 (mount)",
        total,
        changedCount: 0,
        patchTotal: 0,
        handlerOnly: 0,
        steps: [
            { name: "mount", detail: `render()를 한 번 실행해 VNode(${total}개 노드)를 만들고, vnodeToDom으로 실제 DOM 전체를 처음 만들었습니다. 비교할 이전 화면이 없어서 diff와 patch는 없습니다.` },
            { name: "hooks", detail: `훅 ${rows.length}개가 hooks 배열에 초기값으로 저장됐습니다. 아래 3번에서 확인하세요.` },
            { name: "effect", detail: "첫 렌더라 모든 effect가 실행 대상이지만, 틀린 카드 되돌리기 effect는 카드가 두 장일 때만 타이머를 겁니다." },
        ],
        cards: [],
        rows,
        tree: treeLines(component.oldVNode),
    });
}
