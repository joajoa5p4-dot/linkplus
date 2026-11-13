# ERUDA · 공식 신청서 모음 (PC)

일러스트 시안(SVG/PNG) 기준으로 만든 정적 웹앱입니다. 빌드 과정 없이 그대로 Vercel에 배포됩니다.

```
index.html          화면 틀
css/style.css       디자인 (1920px 기준, 화면 폭에 비례해 확대/축소)
js/app.js           화면·기능 (사용자/관리자 화면, 모달, 엑셀 업·다운)
js/model.js         기종 분류·정렬, 엑셀 읽기/쓰기 규칙
js/store.js         저장소 (Firebase ↔ 로컬 데모 자동 전환)
js/image.js         이미지 → WebP 변환·압축 → Base64
js/firebase-config.js   ★ Firebase 값 넣는 곳
vendor/xlsx.full.min.js 엑셀 라이브러리(SheetJS)
firestore.rules     Firestore 보안 규칙
```

## 1. 로컬에서 먼저 보기
`firebase-config.js` 가 `null` 인 동안은 **로컬 데모 모드**(브라우저 localStorage)로 동작합니다.
```
npx serve .      # 또는 python3 -m http.server
```
사용자 화면 `#/user`, 관리자 화면 `#/admin` (사이드바 아래 "관리자 설정").

## 2. Firebase 연동
1. Firebase 콘솔 → 프로젝트 생성 → **Firestore Database** 만들기(프로덕션 모드)
2. 프로젝트 설정 → 내 앱(웹) → **구성 값**을 `js/firebase-config.js` 의 `firebaseConfig` 에 붙여넣기
3. Firestore → 규칙 탭에 `firestore.rules` 내용을 붙여넣고 게시

저장 구조 (문서 1MB 제한 방지 — 항목마다 개별 문서):
```
partners/{pid}                 거래처 메타 (group, name, order, wired{}, updatedAt)
partners/{pid}/rows/{rid}      기종 1개 = 문서 1개
partners/{pid}/notices/{nid}   공지 1개 = 문서 1개
partners/{pid}/images/{iid}    첨부 이미지(WebP Base64) 1개 = 문서 1개
```
- 사이트 진입 시 `partners` 를 getDocs 로 새로 조회하고, 거래처를 열 때마다 해당 거래처의 하위 컬렉션을 다시 조회해 화면을 새로 그립니다.
- 저장할 때는 바뀐 문서만 쓰고, 사라진 문서는 삭제합니다.
- 이미지는 브라우저에서 WebP 로 강제 변환·압축(문서당 약 600KB 이하) 후 유선 인터넷 상세의 메모에 첨부됩니다 (거래처당 최대 10장).

## 3. GitHub → Vercel
```
git init && git add . && git commit -m "init"
git remote add origin https://github.com/<계정>/<저장소>.git && git push -u origin main
```
Vercel → Add New Project → 저장소 선택 → Framework Preset `Other`, 빌드 명령 없음, 출력 디렉터리 `.` → Deploy

## 엑셀 규칙
- 시트 이름 `대분류(소분류)` → `KT(위비즈)` = 대분류 KT, 소분류 위비즈. (`SKT`, `LG`/`LGU`, `KT` 인식)
- 시트 내용: A=모델명, B=가입형태(MNP/기변/신규가입), C=URL (1행 제목)
- 기종 색: 갤럭시 계열=연한 블루, 아이폰 계열=연한 초록, 워치·기타=연한 회색
- 정렬(사용자·관리자 공통): 기타 > 갤럭시 > 아이폰 > 가나다 (영문·숫자 시작 → 한글 시작 순)
- 거래처 이름을 바꾸면 이후 엑셀 업로드 시 같은 이름의 시트와 매칭됩니다.

> ⚠️ 신청서 링크가 담긴 엑셀 원본은 GitHub 저장소에 올리지 마세요 (`.gitignore` 에 `*.xlsx` 포함).
> 로그인이 없으므로 사이트 주소를 아는 사람은 관리자 화면(`#/admin`)에서 수정도 할 수 있습니다. 주소 관리에 주의하세요.
