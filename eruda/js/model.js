// 데이터 모델 · 엑셀 읽기/쓰기 · 자동 정렬
export const GROUPS = [
  { key: 'SKT', label: 'SKT 신청서' },
  { key: 'LG', label: 'LG 신청서' },
  { key: 'KT', label: 'KT 신청서' },
];

export const TYPES = ['MNP', '기변', '신규가입'];

export const DEFAULT_REQUIRED = `OSS 원스탑 여부 : n
동판 여부 : y

고객명 :
주민번호 :
설치장소 :
결합 유형: 요즘가족결합 1회선
결합 전화번호 : 010-3256-5211
(법대 연락처: or 실제 연락받을연락처:)

인터넷 요금제 :
BTV 1대요금제 :
BTV 셋탑종류 :
BTV 2대요금제 :
BTV 셋탑종류 :`;

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now() + Math.random().toString(16).slice(2));

/* ── 기종 분류: etc(워치·기타 → 연한 회색) / galaxy(연한 블루) / iphone(연한 초록) ── */
const RE_WATCH = /워치|watch/i;
const RE_IPHONE = /아이폰|iphone/i;
const RE_GALAXY =
  /갤럭시|galaxy|^[\s(]*(new\)?\s*)?s\d{2}|플립|폴드|flip|fold|\bsm-|\ba\d{2}\b|^z\s?\d|탭|tab\s?s|버즈|점프|버디|퀀텀|와이드/i;

export function detectKind(name, fallback = 'etc') {
  const n = (name || '').trim();
  if (!n) return fallback;
  if (RE_WATCH.test(n)) return 'etc';
  if (RE_IPHONE.test(n)) return 'iphone';
  if (RE_GALAXY.test(n)) return 'galaxy';
  return fallback === 'etc' ? 'etc' : fallback;
}

const KIND_RANK = { etc: 0, galaxy: 1, iphone: 2 };
const HANGUL = /^[\u3131-\u318E\uAC00-\uD7A3]/;
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

/** 기타 > 갤럭시 > 아이폰 > 가나다 순. 이름이 비어있는 (작성 중) 항목은 맨 아래. */
export function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const ae = !(a.model || '').trim(), be = !(b.model || '').trim();
    if (ae !== be) return ae ? 1 : -1;
    const k = (KIND_RANK[a.kind] ?? 0) - (KIND_RANK[b.kind] ?? 0);
    if (k) return k;
    // 영문·숫자로 시작하는 이름 → 한글로 시작하는 이름 순, 각각 가나다/오름차순
    const ah = HANGUL.test(a.model.trim()) ? 1 : 0, bh = HANGUL.test(b.model.trim()) ? 1 : 0;
    if (ah !== bh) return ah - bh;
    return collator.compare(a.model || '', b.model || '');
  });
}

export function newRow(kind) {
  return {
    id: uid(),
    model: '',
    kind,
    mode: kind === 'etc' ? 'new' : 'mnp', // new=신규가입 1칸, mnp=MNP+기변 2칸
    links: { MNP: '', 기변: '', 신규가입: '' },
  };
}

export function newPartner(group, name, order) {
  return {
    id: uid(),
    group,
    name,
    order: order ?? Date.now(),
    rows: [],
    notices: [],
    images: [],
    _loaded: true,
    _snap: {},
    wired: { link: '', required: DEFAULT_REQUIRED, memo: '' },
    updatedAt: 0,
  };
}

/* ── 엑셀 ── */
const normGroup = (g) => {
  const u = g.toUpperCase().replace(/[\s+]/g, '');
  if (u === 'SKT' || u === 'SK') return 'SKT';
  if (u === 'LG' || u === 'LGU' || u === 'LGUPLUS') return 'LG';
  if (u === 'KT') return 'KT';
  return null;
};
const normType = (t) => {
  const s = String(t || '').replace(/\s/g, '');
  if (/^mnp$/i.test(s)) return 'MNP';
  if (/^(기변|기기변경)$/.test(s)) return '기변';
  if (/^(신규가입|신규)$/.test(s)) return '신규가입';
  return null;
};

/** 시트 이름 "KT(위비즈)" → 괄호 앞 = 대분류(KT), 괄호 안 = 소분류(위비즈) */
export function parseSheetName(sheetName) {
  const m = String(sheetName).trim().match(/^(.+?)\s*[(（]\s*(.+)\s*[)）]\s*$/);
  if (!m) return null;
  const group = normGroup(m[1]);
  if (!group) return null;
  return { group, name: m[2].trim() };
}

/** 워크북 → [{group,name,rows}] , 읽지 못한 시트 목록 */
export function parseWorkbook(XLSX, wb) {
  const sheets = [];
  const skipped = [];
  for (const sn of wb.SheetNames) {
    const info = parseSheetName(sn);
    if (!info) { skipped.push(sn); continue; }
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: false });
    const map = new Map();
    data.forEach((r, i) => {
      const model = String(r[0] ?? '').trim();
      const type = normType(r[1]);
      const url = String(r[2] ?? '').trim();
      if (!model || (i === 0 && /모델/.test(model))) return;
      if (!map.has(model)) {
        map.set(model, {
          id: uid(), model, kind: detectKind(model), mode: 'mnp',
          links: { MNP: '', 기변: '', 신규가입: '' },
        });
      }
      if (type) map.get(model).links[type] = url;
    });
    const rows = [...map.values()].map((r) => {
      r.mode = !r.links.MNP && !r.links.기변 && r.links.신규가입 ? 'new' : 'mnp';
      return r;
    });
    sheets.push({ ...info, rows });
  }
  return { sheets, skipped };
}

/** 모든 거래처 → 엑셀(시트명 = 대분류(소분류)) */
export function buildWorkbook(XLSX, partners) {
  const wb = XLSX.utils.book_new();
  const used = new Set();
  [...partners]
    .sort((a, b) => GROUPS.findIndex(g => g.key === a.group) - GROUPS.findIndex(g => g.key === b.group) || a.order - b.order)
    .forEach((p) => {
      const aoa = [['모델명', '가입형태', 'URL']];
      sortRows(p.rows).forEach((r) => {
        if (!(r.model || '').trim()) return;
        const types = r.mode === 'new' ? ['신규가입'] : ['MNP', '기변'];
        types.forEach((t) => aoa.push([r.model, t, r.links[t] || '']));
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 90 }];
      let nm = `${p.group}(${p.name})`.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
      let i = 2;
      while (used.has(nm)) nm = nm.slice(0, 28) + `_${i++}`;
      used.add(nm);
      XLSX.utils.book_append_sheet(wb, ws, nm);
    });
  return wb;
}

export const pad = (n) => String(n).padStart(2, '0');
export function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${String(d.getFullYear()).slice(2)}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
