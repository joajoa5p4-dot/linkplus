// 이미지 → WebP 강제 변환·압축 → Base64(data URL)
// Firestore 문서 1MB 제한을 넘지 않도록 용량이 충분히 작아질 때까지 화질/크기를 낮춥니다.
const MAX_BASE64 = 600 * 1024; // 문서 1개당 목표 상한(약 600KB)

const blobToDataURL = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(blob);
});

export async function imageToWebP(file, maxW = 1600) {
  if (!/^image\//.test(file.type)) throw new Error('이미지 파일이 아닙니다.');
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, maxW / bmp.width);
  let q = 0.82;
  let data = '', w = 0, h = 0;
  for (let i = 0; i < 14; i++) {
    w = Math.max(1, Math.round(bmp.width * scale)); h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', q));
    if (!blob || blob.type !== 'image/webp') throw new Error('이 브라우저는 WebP 변환을 지원하지 않습니다. 최신 Chrome/Edge를 사용해 주세요.');
    data = await blobToDataURL(blob);
    if (data.length <= MAX_BASE64) break;
    if (q > 0.5) q -= 0.1; else scale *= 0.8; // 화질을 먼저, 그래도 크면 해상도를 줄임
  }
  bmp.close?.();
  if (data.length > 900 * 1024) throw new Error('이미지를 충분히 줄이지 못했습니다. 더 작은 이미지를 사용해 주세요.');
  return { data, w, h };
}
