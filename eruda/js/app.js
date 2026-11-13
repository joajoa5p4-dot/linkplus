import {
  GROUPS, TYPES, DEFAULT_REQUIRED, uid, detectKind, sortRows, newRow, newPartner,
  parseWorkbook, buildWorkbook, fmtTime,
} from './model.js';
import * as store from './store.js';
import { imageToWebP } from './image.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

const state = {
  partners: [],
  view: 'intro', // intro | user | admin
  id: null,
  open: { SKT: true, LG: false, KT: false },
  dirty: new Set(),
  deleted: new Set(), // 삭제 대기(저장하기를 눌러야 서버에서 삭제)
  sel: new Set(),
  modal: null, // {type}
  loaded: false,
  busy: false,
  err: '',
};
let slideTimer = null;

/* ───────── 유틸 ───────── */
const byId = (id) => state.partners.find((p) => p.id === id);
const cur = () => byId(state.id);
const inGroup = (g) => state.partners.filter((p) => p.group === g).sort((a, b) => a.order - b.order);
const markDirty = (p) => { state.dirty.add(p.id); };
const hasChanges = () => state.dirty.size > 0 || state.deleted.size > 0;
/** 대분류는 1개만 열림 (나머지는 자동으로 닫힘) */
const openOnly = (g) => { Object.keys(state.open).forEach((k) => { state.open[k] = k === g; }); };
const url = (u) => { u = (u || '').trim(); return /^https?:\/\//i.test(u) ? u : u ? 'https://' + u : ''; };

function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('링크가 복사되었습니다');
}

const IC = {
  chev: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  doc: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 1.8h6l3 3v9.4h-9z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M19.4 13a7.5 7.5 0 000-2l2.1-1.6a.5.5 0 00.1-.6l-2-3.5a.5.5 0 00-.6-.2l-2.5 1a7.3 7.3 0 00-1.7-1l-.4-2.6a.5.5 0 00-.5-.4h-4a.5.5 0 00-.5.4l-.4 2.6c-.6.2-1.2.6-1.7 1l-2.5-1a.5.5 0 00-.6.2l-2 3.5a.5.5 0 00.1.6L4.6 11a7.5 7.5 0 000 2l-2.1 1.6a.5.5 0 00-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.8 1.7 1l.4 2.6c0 .2.2.4.5.4h4c.3 0 .5-.2.5-.4l.4-2.6c.6-.2 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 00-.1-.6zM12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11m-5-4l5 5 5-5M4 20h16"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4m-5 5l5-5 5 5M4 20h16"/></svg>',
  save: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M5 3h11l4 4v13a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1zm2 1v5h9V4zm5 8a3 3 0 100 6 3 3 0 000-6z"/></svg>',
};

/* ───────── 라우팅 ───────── */
function parseHash() {
  const m = location.hash.match(/^#\/(user|admin)(?:\/([^/]+))?/);
  return m ? { view: m[1], id: m[2] || null } : { view: 'user', id: null };
}
export function go(view, id) { location.hash = `#/${view}${id ? '/' + id : ''}`; }

async function route() {
  if (!sessionStorage.getItem('eruda_ok')) { state.view = 'intro'; return render(); }
  const r = parseHash();
  state.view = r.view;
  // 사이트 진입(초기 로드)마다 Firestore 에서 최신 거래처 목록을 새로 조회해 화면을 그린다
  if (!state.loaded) {
    state.busy = true; state.err = ''; state.id = null; render();
    try { state.partners = await store.loadPartners(); }
    catch (err) { console.error(err); state.err = err.code || err.message || '알 수 없는 오류'; state.partners = []; }
    state.loaded = true; state.busy = false;
  }
  let p = r.id && byId(r.id);
  if (!p) p = firstPartner();
  state.id = p ? p.id : null;
  if (p) openOnly(p.group);
  state.sel.clear();
  if (p && !state.dirty.has(p.id)) p._loaded = false; // 거래처를 열 때마다 최신 기종/공지를 다시 조회
  render();
  if (p && !p._loaded) await fetchDetail(p);
}
/** 거래처 1곳의 기종·공지·이미지를 서버에서 조회해 화면을 새로 그린다 */
async function fetchDetail(p) {
  try {
    const d = await store.loadDetail(p.id);
    if (state.dirty.has(p.id)) return;
    p.rows = d.rows; p.notices = d.notices; p.images = d.images; p._snap = d.snap; p._loaded = true; p._error = '';
  } catch (err) { console.error(err); p._error = err.code || err.message || '오류'; }
  if (state.id === p.id) render();
}
function firstPartner() {
  for (const g of GROUPS) { const l = inGroup(g.key); if (l.length) return l[0]; }
  return null;
}

/* ───────── 화면 조각 ───────── */
function brandHTML(p) {
  const t = p ? `<h1 class="ptitle">${esc(p.name)}</h1>` : '';
  let logos = '';
  if (p?.group === 'SKT') logos = '<img class="lg lg-skt" src="assets/logo-skt.png" alt="SK telecom">';
  else if (p?.group === 'LG') logos = '<img class="lg lg-lgu" src="assets/logo-lgu.png" alt="LG U+">';
  else if (p?.group === 'KT') logos = '<img class="lg lg-kt" src="assets/logo-kt.png" alt="kt"><img class="lg lg-olleh" src="assets/logo-olleh.png" alt="olleh">';
  return `<div class="brand">${logos}${t}</div>`;
}

function sidebarHTML(admin) {
  const groups = GROUPS.map((g) => {
    const list = inGroup(g.key);
    const items = list.map((p) => `<li><a class="sub${p.id === state.id ? ' on' : ''}" href="#/${admin ? 'admin' : 'user'}/${p.id}">${esc(p.name)}</a></li>`).join('');
    return `<section class="grp g-${g.key}${state.open[g.key] ? ' open' : ''}">
      <button class="grp-h" data-act="toggle" data-g="${g.key}" aria-expanded="${!!state.open[g.key]}">${IC.chev}<span>${g.label}</span></button>
      <div class="grp-body"><div class="grp-inner"><ul class="sub-list"><i class="hl"></i>${items}</ul></div></div>
    </section>`;
  }).join('');
  const foot = admin
    ? `<div class="mk">
        <label>대분류</label>
        <select id="mk-group">${GROUPS.map((g) => `<option value="${g.key}">${g.label}</option>`).join('')}</select>
        <label>소분류</label>
        <input id="mk-name" placeholder="거래처명을 입력해 주세요" maxlength="30">
        <button class="mk-btn" data-act="create">거래처 생성</button>
        <button class="mk-link" data-act="to-user">사용자 화면으로</button>
      </div>`
    : `<button class="admin-link" data-act="to-admin">${IC.gear.replace('width="20" height="20"', 'width="17" height="17"')}<span>관리자 설정</span></button>`;
  return `<aside class="side"><a class="logo" href="#/user" aria-label="ERUDA"><img src="assets/eruda-logo.svg" alt="ERUDA"></a><nav>${groups}</nav>${foot}</aside>`;
}

const bellHTML = '<img class="bell" src="assets/bell.png" alt="">';

function noticeBarHTML(p, admin) {
  const ns = p.notices || [];
  if (admin) {
    const first = ns[0]?.text || '등록된 공지사항이 없습니다';
    return `<div class="notice">${bellHTML}<b>공지사항</b><span class="n-text ${ns.length ? '' : 'dim'}">${esc(first)}</span>
      <button class="n-set" data-act="notice-admin">${IC.gear.replace('width="20" height="20"', 'width="19" height="19"')}공지설정</button></div>`;
  }
  if (!ns.length) return '';
  const slides = ns.map((n) => `<div class="slide">${esc(n.text)}</div>`).join('');
  return `<button class="notice clickable" data-act="notice-user" aria-label="공지사항 자세히 보기">${bellHTML}<b>공지사항</b>
    <span class="slides" data-n="${ns.length}"><span class="slide-track">${slides}</span></span></button>`;
}

function btnPair(u) {
  const dis = u ? '' : ' disabled';
  return `<button class="b-dark" data-act="copy" data-url="${esc(u)}"${dis}>${IC.doc}링크복사</button><button class="b-blue" data-act="go-link" data-url="${esc(u)}"${dis}>바로가기</button>`;
}
function linkUser(label, u) {
  return `<div class="lk"><span class="lb">${label}</span><input class="lin" readonly value="${esc(u)}" aria-label="${label} 링크">${btnPair(u)}</div>`;
}
function linkAdmin(label, r, t) {
  return `<div class="lk"><span class="lb">${label}</span><input class="lin" data-row="${r.id}" data-f="${t}" value="${esc(r.links[t])}" placeholder="여기에 링크를 입력 해주세요" aria-label="${label} 링크"></div>`;
}

function rowsHTML(p, admin) {
  const rows = sortRows(p.rows);
  if (!rows.length) return `<p class="empty">${admin ? '등록된 기종이 없습니다. 위 버튼으로 항목을 추가하거나 엑셀을 업로드하세요.' : '등록된 신청서가 없습니다.'}</p>`;
  return rows.map((r) => {
    const links = r.mode === 'new'
      ? `<div class="grp-links span2">${admin ? linkAdmin('신규가입', r, '신규가입') : linkUser('신규가입', r.links.신규가입)}</div>`
      : ['MNP', '기변'].map((t) => `<div class="grp-links">${admin ? linkAdmin(t, r, t) : linkUser(t, r.links[t])}</div>`).join('');
    const model = admin
      ? `<div class="m-col"><input type="checkbox" class="ck" data-sel="${r.id}" ${state.sel.has(r.id) ? 'checked' : ''} aria-label="선택"><input class="m-in" data-row="${r.id}" data-f="model" value="${esc(r.model)}" placeholder="여기에 기종을 입력 해주세요"></div>`
      : `<div class="m-col"><span class="m-name">${esc(r.model)}</span></div>`;
    return `<div class="row k-${r.kind}">${model}${links}</div>`;
  }).join('');
}

function wiredUserHTML(p) {
  const u = url(p.wired?.link);
  return `<div class="wired"><span class="w-t">유선 인터넷</span><button class="b-nav" data-act="wired-user">상세 정보보기</button>
    <input class="w-in" readonly value="${esc(p.wired?.link || '')}" aria-label="유선 인터넷 링크">${btnPair(u)}</div>`;
}
function toolbarHTML() {
  return `<div class="tool">
    <div class="t-wired"><span>유선 인터넷</span><button data-act="wired-admin">${IC.gear.replace('width="20" height="20"', 'width="19" height="19"')}공지설정</button></div>
    <button class="t-gray" data-act="sel-all">전체선택</button><button class="t-gray" data-act="sel-none">전체해제</button><button class="t-gray" data-act="sel-del">선택삭제</button>
    <button class="t-add gal" data-act="add" data-k="galaxy">항목추가_갤럭시</button><button class="t-add iph" data-act="add" data-k="iphone">항목추가_아이폰</button><button class="t-add etc" data-act="add" data-k="etc">항목추가_기타</button>
    <span class="grow"></span>
    <button class="t-xl dn" data-act="xl-down">${IC.down}EXCEL 다운</button><button class="t-xl up" data-act="xl-up">${IC.up}EXCEL 업로드</button>
    <button class="t-save${hasChanges() ? ' dirty' : ''}" data-act="save">${IC.save}저장하기</button>
    <input type="file" id="xl-file" accept=".xlsx,.xls" hidden>
  </div>
  <div class="p-tools"><button data-act="rename">거래처명 변경</button><button class="danger" data-act="delete">거래처 삭제</button></div>`;
}

function mainHTML(admin) {
  const p = cur();
  if (state.busy) return '<main class="main"><div class="loading"><i></i>데이터를 불러오는 중…</div></main>';
  if (state.err) return `<main class="main"><div class="empty big">데이터를 불러오지 못했습니다.<br><small>${esc(state.err)} — Firebase 설정/보안 규칙을 확인하세요.</small></div></main>`;
  if (p && p._error) return `<main class="main"><div class="empty big">데이터를 불러오지 못했습니다.<br><small>${esc(p._error)}</small></div></main>`;
  if (p && !p._loaded) return `<main class="main"><header class="top">${brandHTML(p)}</header><div class="loading"><i></i>최신 데이터를 불러오는 중…</div></main>`;
  if (!p) {
    return `<main class="main"><div class="empty big">${admin
      ? `거래처가 없습니다. 왼쪽 아래에서 거래처를 만들거나, 엑셀로 한 번에 불러오세요.<br><button class="t-xl up first-up" data-act="xl-up">${IC.up}EXCEL 업로드</button><input type="file" id="xl-file" accept=".xlsx,.xls" hidden>`
      : '등록된 거래처가 없습니다. 관리자 설정에서 거래처를 만들어 주세요.'}</div></main>`;
  }
  return `<main class="main" id="main">
    <header class="top">${brandHTML(p)}<div class="upd">최근 업데이트 날짜 : ${fmtTime(p.updatedAt)}</div></header>
    ${noticeBarHTML(p, admin)}
    ${admin ? toolbarHTML() : wiredUserHTML(p)}
    <div class="rows">${rowsHTML(p, admin)}</div>
  </main>`;
}

/* ───────── 모달 ───────── */
function thumbsHTML(p, admin) {
  const list = p.images || [];
  if (!list.length) return '';
  return `<div class="thumbs">${list.map((m) => `<span class="th"><button class="th-b" data-act="zoom" data-img="${m.id}" aria-label="이미지 크게 보기"><img src="${m.data}" alt="${esc(m.name)}"></button>${admin ? `<button class="th-x" data-act="img-del" data-img="${m.id}" aria-label="이미지 삭제">×</button>` : ''}</span>`).join('')}</div>`;
}
function modalHTML() {
  const m = state.modal; if (!m) return '';
  const p = cur();
  const close = '<button class="x" data-act="close" aria-label="닫기">X</button>';
  if (m.type === 'zoom') {
    const im = (p?.images || []).find((x) => x.id === m.id);
    return im ? `<div class="ov zoom-ov" data-act="zoom-close"><img class="zoom" src="${im.data}" alt="${esc(im.name)}"></div>` : '';
  }
  if (!p) return '';
  if (m.type === 'notice-user') {
    const list = (p.notices || []).map((n) => `<div class="notice full">${bellHTML}<b>공지사항</b><span class="n-text wrap">${esc(n.text)}</span></div>`).join('');
    return `<div class="ov" data-act="close-ov"><div class="md">${close}${brandHTML(p)}<div class="n-list">${list}</div></div></div>`;
  }
  if (m.type === 'notice-admin') {
    const list = (p.notices || []).map((n) => `<div class="notice edit"><input type="checkbox" class="ck" data-nsel="${n.id}" ${state.sel.has(n.id) ? 'checked' : ''} aria-label="선택"><input class="n-in" data-nid="${n.id}" value="${esc(n.text)}" placeholder="여기에 공지사항을 입력 해주세요"></div>`).join('');
    return `<div class="ov"><div class="md">${close}${brandHTML(p)}
      <div class="md-bar"><p>공지사항은 넘어가는 슬라이드가 적용 되고 클릭시 상세내역을 볼수있습니다</p>
      <div class="md-btns"><button class="t-gray dk" data-act="n-add">항목추가</button><button class="t-gray" data-act="n-all">전체선택</button><button class="t-gray" data-act="n-none">선택해제</button><button class="t-gray" data-act="n-del">선택삭제</button></div></div>
      <div class="n-list">${list}</div></div></div>`;
  }
  const w = p.wired || {};
  if (m.type === 'wired-user') {
    const u = url(w.link);
    return `<div class="ov" data-act="close-ov"><div class="md">${close}${brandHTML(p)}
      <div class="md-link"><input class="lin" readonly value="${esc(w.link || '')}" aria-label="유선 인터넷 링크">${btnPair(u)}</div>
      <div class="md-cols"><section><h3>필독사항</h3><div class="ta ro">${esc(w.required)}</div></section><section><h3>메모</h3><div class="ta ro"><div>${esc(w.memo)}</div>${thumbsHTML(p, false)}</div></section></div></div></div>`;
  }
  if (m.type === 'wired-admin') {
    return `<div class="ov"><div class="md">${close}${brandHTML(p)}
      <div class="md-link"><input class="lin" data-w="link" value="${esc(w.link)}" placeholder="여기에 링크를 입력 해주세요" aria-label="유선 인터넷 링크"></div>
      <div class="md-cols"><section><h3>필독사항</h3><textarea class="ta" data-w="required" placeholder="여기에 필독사항을 입력 해주세요">${esc(w.required)}</textarea></section>
      <section><h3>메모</h3><textarea class="ta ta-s" data-w="memo" placeholder="여기에 메모를 입력 해주세요">${esc(w.memo)}</textarea>
      <div class="img-bar"><button class="t-gray dk" data-act="img-add">이미지 첨부</button><span class="hint">WebP로 자동 변환·압축되어 저장됩니다</span>${thumbsHTML(p, true)}</div>
      <input type="file" id="img-file" accept="image/*" multiple hidden></section></div></div></div>`;
  }
  return '';
}

/* ───────── 렌더 ───────── */
function render() {
  clearInterval(slideTimer);
  if (state.view === 'intro') {
    app.innerHTML = `<div class="intro"><img class="i-logo" src="assets/eruda-logo.svg" alt="ERUDA">
      <p>이루다의 공식 신청서를 모은 페이지 입니다<br>링크 유출에 주의를 부탁드립니다</p>
      <button class="i-btn" data-act="enter">동의하고 접속하기</button><span class="ver">ver. 2026.11.13_01</span></div>`;
    return;
  }
  const admin = state.view === 'admin';
  const scroll = $('#main')?.scrollTop || 0;
  app.innerHTML = `<div class="shell${admin ? ' is-admin' : ''}">${sidebarHTML(admin)}${mainHTML(admin)}</div><div id="modal">${modalHTML()}</div>`;
  const mn = $('#main'); if (mn) mn.scrollTop = scroll;
  placeHighlights(false);
  requestAnimationFrame(() => placeHighlights(false));
  document.fonts?.ready.then(() => placeHighlights(false));
  startSlides();
}
function renderModal() { $('#modal').innerHTML = modalHTML(); }
function rerenderRows() {
  const p = cur(); const rows = $('.rows'); if (!rows) return;
  rows.innerHTML = rowsHTML(p, state.view === 'admin');
}
function refreshSave() { $('.t-save')?.classList.toggle('dirty', hasChanges()); }

/* 공지 슬라이드 (세로로 넘어감) */
function startSlides() {
  const el = $('.slides'); if (!el) return;
  const n = +el.dataset.n; if (n < 2) return;
  const track = $('.slide-track', el); let i = 0;
  slideTimer = setInterval(() => {
    i = (i + 1) % n;
    track.style.transform = `translateY(${-i * 100}%)`;
  }, 3500);
}

/* 사이드바 소분류: 마우스를 따라 이동하는 색상 박스 */
function moveHl(list, item, animate = true) {
  const hl = $('.hl', list);
  hl.style.transition = animate ? '' : 'none';
  if (!item) { hl.style.opacity = 0; $$('.sub.under', list).forEach((a) => a.classList.remove('under')); return; }
  hl.style.opacity = 1;
  const li = item.closest('li');
  hl.style.height = item.offsetHeight + 'px';
  hl.style.transform = `translateY(${li.offsetTop}px)`;
  $$('.sub', list).forEach((a) => a.classList.toggle('under', a === item));
  if (!animate) hl.getBoundingClientRect(), (hl.style.transition = '');
}
function placeHighlights(animate) {
  $$('.sub-list').forEach((list) => moveHl(list, $('.sub.on', list), animate));
}

/* ───────── 이벤트 ───────── */
document.addEventListener('mouseover', (e) => {
  const a = e.target.closest?.('.sub'); if (!a) return;
  moveHl(a.closest('.sub-list'), a);
});
document.addEventListener('mouseout', (e) => {
  const list = e.target.closest?.('.sub-list'); if (!list) return;
  if (list.contains(e.relatedTarget)) return;
  moveHl(list, $('.sub.on', list));
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (act === 'close-ov' && e.target !== el) return; // 오버레이 바깥 클릭만
  const p = cur(); const admin = state.view === 'admin';
  switch (act) {
    case 'enter': sessionStorage.setItem('eruda_ok', '1'); route(); break;
    case 'toggle': {
      const g = el.dataset.g; const willOpen = !state.open[g];
      Object.keys(state.open).forEach((k) => { state.open[k] = willOpen && k === g; });
      $$('.grp').forEach((sec) => {
        const k = sec.querySelector('.grp-h').dataset.g;
        sec.classList.toggle('open', !!state.open[k]);
        sec.querySelector('.grp-h').setAttribute('aria-expanded', !!state.open[k]);
      });
      setTimeout(() => placeHighlights(false), 340);
      break;
    }
    case 'to-admin': go('admin', state.id); break;
    case 'to-user':
      if (hasChanges() && !confirm('저장하지 않은 변경사항이 있습니다. 버리고 이동할까요?')) break;
      if (hasChanges()) { state.dirty.clear(); state.deleted.clear(); state.loaded = false; }
      go('user', state.id); break;
    case 'copy': if (el.dataset.url) copyText(el.dataset.url); break;
    case 'go-link': if (el.dataset.url) window.open(el.dataset.url, '_blank', 'noopener'); break;
    case 'zoom': state.modal = { type: 'zoom', id: el.dataset.img, back: state.modal }; renderModal(); break;
    case 'zoom-close': state.modal = state.modal.back; renderModal(); break;
    case 'img-add': $('#img-file').click(); break;
    case 'img-del': p.images = p.images.filter((m) => m.id !== el.dataset.img); markDirty(p); renderModal(); refreshSave(); break;
    case 'close': case 'close-ov': state.modal = null; renderModal(); if (admin) render(); break;
    case 'notice-user': case 'wired-user': state.modal = { type: act }; renderModal(); break;
    case 'notice-admin': case 'wired-admin': state.sel.clear(); state.modal = { type: act }; renderModal(); break;

    /* 관리자: 목록 편집 */
    case 'sel-all': p.rows.forEach((r) => state.sel.add(r.id)); rerenderRows(); break;
    case 'sel-none': state.sel.clear(); rerenderRows(); break;
    case 'sel-del': {
      const n = p.rows.filter((r) => state.sel.has(r.id)).length;
      if (!n) { toast('삭제할 항목을 선택하세요'); break; }
      if (!confirm(`선택한 ${n}개 항목을 삭제할까요?`)) break;
      p.rows = p.rows.filter((r) => !state.sel.has(r.id)); state.sel.clear(); markDirty(p); rerenderRows(); refreshSave(); break;
    }
    case 'add': {
      p.rows.push(newRow(el.dataset.k)); markDirty(p); rerenderRows(); refreshSave();
      const inputs = $$('.m-in'); inputs[inputs.length - 1]?.focus();
      $('#main').scrollTop = $('#main').scrollHeight; break;
    }
    case 'save': await saveAll(); break;
    case 'xl-down': {
      if (!window.XLSX) return alert('엑셀 라이브러리를 불러오지 못했습니다.');
      toast('최신 데이터를 불러오는 중…');
      await Promise.all(state.partners.filter((x) => !x._loaded && !state.dirty.has(x.id)).map(fetchDetail));
      const wb = buildWorkbook(XLSX, state.partners);
      const d = new Date(); const s = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      XLSX.writeFile(wb, `공식신청서_${s}.xlsx`); break;
    }
    case 'xl-up': $('#xl-file').click(); break;
    case 'create': await createPartner(); break;
    case 'rename': {
      const nn = prompt('새 거래처명을 입력하세요 (엑셀 시트명과 같게 유지하세요)', p.name)?.trim();
      if (nn && nn !== p.name) { p.name = nn; markDirty(p); render(); }
      break;
    }
    case 'delete':
      if (!confirm(`'${p.group} · ${p.name}' 거래처를 삭제할까요?\n(저장하기를 눌러야 서버에서 삭제됩니다)`)) break;
      if (!p._new) state.deleted.add(p.id);
      state.partners = state.partners.filter((x) => x.id !== p.id); state.dirty.delete(p.id);
      state.id = null; toast('삭제 대기 중 — 저장하기를 눌러야 반영됩니다'); go('admin'); route(); break;

    /* 공지 편집 */
    case 'n-add': p.notices.push({ id: uid(), text: '' }); markDirty(p); renderModal(); refreshSave(); $$('.n-in').pop()?.focus(); break;
    case 'n-all': p.notices.forEach((n) => state.sel.add(n.id)); renderModal(); break;
    case 'n-none': state.sel.clear(); renderModal(); break;
    case 'n-del':
      p.notices = p.notices.filter((n) => !state.sel.has(n.id)); state.sel.clear(); markDirty(p); renderModal(); refreshSave(); break;
  }
});

document.addEventListener('input', (e) => {
  const t = e.target; const p = cur(); if (!p) return;
  if (t.dataset.row) {
    const r = p.rows.find((x) => x.id === t.dataset.row); if (!r) return;
    if (t.dataset.f === 'model') r.model = t.value; else r.links[t.dataset.f] = t.value;
    markDirty(p); refreshSave();
  } else if (t.dataset.nid) {
    const n = p.notices.find((x) => x.id === t.dataset.nid); if (n) { n.text = t.value; markDirty(p); refreshSave(); }
  } else if (t.dataset.w) {
    p.wired = p.wired || {}; p.wired[t.dataset.w] = t.value; markDirty(p); refreshSave();
  }
});
document.addEventListener('change', async (e) => {
  const t = e.target; const p = cur();
  if (t.dataset.sel) { t.checked ? state.sel.add(t.dataset.sel) : state.sel.delete(t.dataset.sel); }
  else if (t.dataset.nsel) { t.checked ? state.sel.add(t.dataset.nsel) : state.sel.delete(t.dataset.nsel); }
  else if (t.dataset.row && t.dataset.f === 'model' && p) {
    const r = p.rows.find((x) => x.id === t.dataset.row);
    r.model = t.value.trim(); r.kind = detectKind(r.model, r.kind);
    rerenderRows(); // 정렬 반영 (기타 > 갤럭시 > 아이폰 > 가나다)
  } else if (t.id === 'img-file' && t.files.length && p) {
    const files = [...t.files]; t.value = '';
    for (const f of files) {
      if ((p.images || []).length >= 10) { toast('이미지는 최대 10장까지 첨부할 수 있어요'); break; }
      try {
        toast('WebP로 변환하는 중…');
        const im = await imageToWebP(f);
        p.images = p.images || []; p.images.push({ id: uid(), name: f.name.replace(/\.[^.]+$/, '') + '.webp', data: im.data, w: im.w, h: im.h });
        markDirty(p); renderModal(); refreshSave();
        toast(`첨부됨 (${Math.round(im.data.length / 1024)}KB)`);
      } catch (err) { alert(err.message || '이미지를 처리하지 못했습니다.'); }
    }
  } else if (t.id === 'xl-file' && t.files[0]) {
    await importExcel(t.files[0]); t.value = '';
  }
});

window.addEventListener('beforeunload', (e) => { if (hasChanges()) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('hashchange', route);

/* ───────── 동작 ───────── */
/* 저장 진행/완료/실패 팝업 (#app 바깥이라 화면이 다시 그려져도 유지됨) */
function saveBox(kind, title, sub) {
  let box = $('#savebox');
  if (!box) { box = document.createElement('div'); box.id = 'savebox'; document.body.appendChild(box); }
  const btn = kind === 'busy' ? '' : '<button class="sv-ok" data-sv="close">확인</button>';
  box.innerHTML = `<div class="ov sv" role="alertdialog" aria-live="assertive"><div class="sv-card"><i class="sv-ic ${kind}"></i><h3>${esc(title)}</h3><p>${esc(sub || '')}</p>${btn}</div></div>`;
  clearTimeout(saveBox.t);
  if (kind === 'ok') saveBox.t = setTimeout(() => saveBox.close(), 2200);
}
saveBox.close = () => { $('#savebox')?.remove(); };
document.addEventListener('click', (e) => { if (e.target.closest('[data-sv=close]')) saveBox.close(); });

async function saveAll() {
  const list = state.partners.filter((p) => state.dirty.has(p.id));
  const dels = [...state.deleted];
  if (!list.length && !dels.length) return toast('변경된 내용이 없습니다');
  const total = list.length + dels.length; let n = 0;
  const now = Date.now();
  saveBox('busy', '저장 중입니다…', `서버에 저장하고 있어요. 잠시만 기다려 주세요. (0/${total})`);
  try {
    for (const id of dels) { await store.deletePartner(id); state.deleted.delete(id); saveBox('busy', '저장 중입니다…', `서버에 저장하고 있어요. 잠시만 기다려 주세요. (${++n}/${total})`); }
    for (const p of list) {
      p.updatedAt = now; p.rows = sortRows(p.rows);
      p._snap = await store.savePartner(p); // 바뀐 문서만 개별 저장
      state.dirty.delete(p.id); p._new = false;
      saveBox('busy', '저장 중입니다…', `서버에 저장하고 있어요. 잠시만 기다려 주세요. (${++n}/${total})`);
    }
    render();
    saveBox('ok', '저장 완료', '변경사항이 서버에 저장되었습니다.');
  } catch (err) {
    console.error(err); render();
    saveBox('err', '저장 실패', `${err.code || err.message || '알 수 없는 오류'} — 다시 저장하기를 눌러 주세요. (저장 안 된 내용은 그대로 남아 있어요)`);
  }
}

async function createPartner() {
  const g = $('#mk-group').value; const name = $('#mk-name').value.trim();
  if (!name) return toast('거래처명을 입력해 주세요');
  if (state.partners.some((p) => p.group === g && p.name === name)) return toast('이미 있는 거래처입니다');
  const maxOrder = Math.max(0, ...inGroup(g).map((p) => p.order));
  const p = newPartner(g, name, maxOrder + 1); p._new = true;
  state.partners.push(p); markDirty(p); // 저장하기를 눌러야 서버에 생성됨
  openOnly(g); go('admin', p.id); toast('추가됨 — 저장하기를 눌러야 반영됩니다');
}

async function importExcel(file) {
  if (!window.XLSX) return alert('엑셀 라이브러리를 불러오지 못했습니다.');
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const { sheets, skipped } = parseWorkbook(XLSX, wb);
    if (!sheets.length) return alert('읽을 수 있는 시트가 없습니다.\n시트 이름을 "대분류(소분류)" 형식으로 지정해 주세요. 예) KT(위비즈)');
    const total = sheets.reduce((a, s) => a + s.rows.length, 0);
    if (!confirm(`시트 ${sheets.length}개 · 기종 ${total}개를 불러옵니다.\n같은 이름의 거래처는 기종 목록이 덮어쓰기 되고, 없는 거래처는 새로 만들어집니다.\n(저장하기를 눌러야 반영됩니다)`)) return;
    let created = 0;
    toast('기존 데이터를 확인하는 중…');
    for (const s of sheets) {
      let p = state.partners.find((x) => x.group === s.group && x.name === s.name);
      if (!p) {
        p = newPartner(s.group, s.name, Math.max(0, ...inGroup(s.group).map((x) => x.order)) + 1);
        p._new = true; state.partners.push(p); created++;
      } else if (!p._loaded && !state.dirty.has(p.id)) await fetchDetail(p); // 삭제할 옛 문서를 알기 위해 현재 상태 조회
      const old = new Map((p.rows || []).map((r) => [r.model, r.id])); // 같은 기종은 문서 id 재사용(쓰기 최소화)
      s.rows.forEach((r) => { if (old.has(r.model)) r.id = old.get(r.model); });
      p.rows = sortRows(s.rows); markDirty(p);
    }
    if (!cur()) { const f = firstPartner(); if (f) { state.id = f.id; openOnly(f.group); } }
    render();
    toast(`불러오기 완료 (새 거래처 ${created}개)` + (skipped.length ? ` · 건너뜀 ${skipped.length}` : ''));
    if (skipped.length) console.warn('건너뛴 시트:', skipped);
  } catch (err) { console.error(err); alert('엑셀을 읽는 중 오류가 발생했습니다.'); }
}

route();
