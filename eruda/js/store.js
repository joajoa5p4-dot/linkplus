// 저장소: Firebase(Firestore) 또는 로컬 데모(localStorage) 자동 전환
//
// ── Firestore 구조 (문서 1MB 제한 방지: 항목마다 개별 문서) ──
//   partners/{pid}                거래처 메타 (group, name, order, wired{link,required,memo}, updatedAt)
//   partners/{pid}/rows/{rid}     기종 1개 = 문서 1개 (model, kind, mode, links)
//   partners/{pid}/notices/{nid}  공지 1개 = 문서 1개 (text, order)
//   partners/{pid}/images/{iid}   첨부 이미지 1개 = 문서 1개 (WebP Base64, name, order)
import { firebaseConfig } from './firebase-config.js';

const V = '13.3.0';
const CDN = (m) => `https://www.gstatic.com/firebasejs/${V}/firebase-${m}.js`;
const LS_KEY = 'eruda_local_v2';
const SUBS = ['rows', 'notices', 'images'];
const META_KEYS = ['group', 'name', 'order', 'wired', 'updatedAt'];

export const useFirebase = !!(firebaseConfig && firebaseConfig.apiKey);
let fb = null;

async function init() {
  if (fb) return fb;
  const [{ initializeApp }, fs] = await Promise.all([import(CDN('app')), import(CDN('firestore'))]);
  const app = initializeApp(firebaseConfig);
  fb = { fs, db: fs.getFirestore(app) };
  return fb;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const pickMeta = (p) => { const m = {}; META_KEYS.forEach((k) => { if (p[k] !== undefined) m[k] = clone(p[k]); }); return m; };
const stripId = (o) => { const { id, ...rest } = o; return rest; };
/** 저장할 하위 문서 목록 [{coll,id,data}] — 공지/이미지는 현재 순서를 order 로 기록 */
function subDocs(p) {
  const out = [];
  (p.rows || []).forEach((r) => out.push({ coll: 'rows', id: r.id, data: stripId(r) }));
  (p.notices || []).forEach((n, i) => out.push({ coll: 'notices', id: n.id, data: { ...stripId(n), order: i } }));
  (p.images || []).forEach((m, i) => out.push({ coll: 'images', id: m.id, data: { ...stripId(m), order: i } }));
  return out;
}
const key = (coll, id) => `${coll}/${id}`;

/* ───────── 로컬 데모 모드 ───────── */
async function localDb() {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) return JSON.parse(raw); } catch (e) { /* ignore */ }
  const db = { partners: [], detail: {} };
  try {
    const demo = await (await fetch('data/demo.json')).json();
    demo.forEach((p) => {
      db.partners.push(pickMeta(p) && { id: p.id, ...pickMeta(p) });
      db.detail[p.id] = { rows: p.rows || [], notices: p.notices || [], images: [] };
    });
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch (e) { /* ignore */ }
  return db;
}
const localSave = (db) => localStorage.setItem(LS_KEY, JSON.stringify(db));

/* ───────── 공통 API ───────── */

/** 거래처 목록(메타만) — 사이트 진입 시마다 서버에서 새로 조회 */
export async function loadPartners() {
  if (!useFirebase) return (await localDb()).partners.map(clone);
  const { fs, db } = await init();
  const snap = await fs.getDocs(fs.collection(db, 'partners'));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

/** 거래처 1곳의 기종·공지·이미지 — 선택할 때마다 서버에서 새로 조회 */
export async function loadDetail(pid) {
  const out = { rows: [], notices: [], images: [], snap: {} };
  if (!useFirebase) {
    const d = (await localDb()).detail[pid] || {};
    SUBS.forEach((s) => { out[s] = clone(d[s] || []); });
  } else {
    const { fs, db } = await init();
    const snaps = await Promise.all(SUBS.map((s) => fs.getDocs(fs.collection(db, 'partners', pid, s))));
    SUBS.forEach((s, i) => { out[s] = snaps[i].docs.map((d) => ({ ...d.data(), id: d.id })); });
  }
  out.notices.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  out.images.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  subDocs(out).forEach((d) => { out.snap[key(d.coll, d.id)] = JSON.stringify(d.data); });
  return out;
}

/** 변경된 문서만 쓰고, 사라진 문서는 삭제. 새 snap 반환 */
export async function savePartner(p) {
  const docs = subDocs(p);
  const prev = p._snap || {};
  const next = {};
  docs.forEach((d) => { next[key(d.coll, d.id)] = JSON.stringify(d.data); });
  const writes = docs.filter((d) => prev[key(d.coll, d.id)] !== next[key(d.coll, d.id)]);
  const removed = Object.keys(prev).filter((k) => !(k in next));

  if (!useFirebase) {
    const db = await localDb();
    const meta = { id: p.id, ...pickMeta(p) };
    const i = db.partners.findIndex((x) => x.id === p.id);
    if (i >= 0) db.partners[i] = meta; else db.partners.push(meta);
    db.detail[p.id] = { rows: clone(p.rows || []), notices: clone(p.notices || []), images: clone(p.images || []) };
    localSave(db);
    return next;
  }
  const { fs, db } = await init();
  const ops = [{ t: 'set', ref: fs.doc(db, 'partners', p.id), data: pickMeta(p) }];
  writes.forEach((d) => ops.push({ t: 'set', ref: fs.doc(db, 'partners', p.id, d.coll, d.id), data: d.data }));
  removed.forEach((k) => { const [c, id] = k.split('/'); ops.push({ t: 'del', ref: fs.doc(db, 'partners', p.id, c, id) }); });
  for (let i = 0; i < ops.length; i += 400) {
    const batch = fs.writeBatch(db);
    ops.slice(i, i + 400).forEach((o) => (o.t === 'set' ? batch.set(o.ref, o.data) : batch.delete(o.ref)));
    await batch.commit();
  }
  return next;
}

export async function deletePartner(pid) {
  if (!useFirebase) {
    const db = await localDb();
    db.partners = db.partners.filter((x) => x.id !== pid); delete db.detail[pid]; localSave(db);
    return;
  }
  const { fs, db } = await init();
  const snaps = await Promise.all(SUBS.map((s) => fs.getDocs(fs.collection(db, 'partners', pid, s))));
  const refs = snaps.flatMap((s) => s.docs.map((d) => d.ref));
  for (let i = 0; i < refs.length; i += 400) {
    const batch = fs.writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  await fs.deleteDoc(fs.doc(db, 'partners', pid));
}
