import type { Attendance, Feedback, Member, Practice } from './types';

/** 練習の登録（スクショ送信・アプリでの登録）は、いずれかのグループに所属するメンバーか予約者・管理者だけができる */
export function canRegister(m: Member | null): boolean {
  return m != null && (m.role !== '一般' || m.groups.length > 0);
}

export function isAdmin(m: Member | null): boolean {
  return m != null && m.role === '管理者';
}

/**
 * 練習が見えるのは、管理者・予約者・募集を送ったグループに入っている人・出欠に関わった人（involved）だけ。
 * 例: グループ1にだけ募集した練習は、グループ2にしかいない人には見えない
 */
export function canSeePractice(m: Member | null, p: Practice, involved = false): boolean {
  return m != null && (m.role === '管理者' || p.booker === m.userId || involved || p.groups.some((g) => m.groups.includes(g)));
}

/** 練習の修正・中止・金額調整ができるのは、その練習の予約者と管理者だけ */
export function canEditPractice(m: Member | null, p: Practice): boolean {
  return m != null && (m.role === '管理者' || p.booker === m.userId);
}

/** 続けて取った予約で練習を延長できるのは、その練習の予約者と管理者だけ（ほかの人の予約は新しい練習になる） */
export function canExtendPractice(m: Member | null, p: Practice): boolean {
  return canEditPractice(m, p);
}

/** 出欠の取り消し：予約者・管理者・追加した本人・回答した本人 */
export function canRemoveAttendance(m: Member | null, p: Practice, a: Attendance): boolean {
  if (m == null) return false;
  return canEditPractice(m, p) || a.addedBy === m.userId || a.participant === m.userId;
}

/** 要望を消せるのは投稿した本人と管理者 */
export function canDeleteFeedback(m: Member | null, f: Feedback): boolean {
  return m != null && (m.role === '管理者' || f.userId === m.userId);
}

/** タイミング差を抑えた文字列比較（合言葉・キーの照合用） */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(++i);
      c = ((c - 0xd800) << 10) + (lo - 0xdc00) + 0x10000;
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

/** 環境非依存の SHA-256（16進小文字）。GAS / Node / ブラウザすべてで同じ値を返す */
export function sha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array<number>(64);
  const r = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = r(e, 6) ^ r(e, 11) ^ r(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = r(a, 2) ^ r(a, 13) ^ r(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** .ics 配信専用の読み取りキー。参加リンクの joinKey から片方向導出し、.ics URL 流出時に参加リンク権限が漏れないようにする */
export function deriveIcsKey(practiceId: string, joinKey: string): string {
  return sha256Hex(`ics:${practiceId}:${joinKey}`).slice(0, 32);
}

/** 削除権限のない閲覧者向けに、参加リンクゲストの内部ID（guest:<uuid>）を安定した別IDへマスクする */
export function maskJoinGuestId(practiceId: string, participant: string): string {
  return `guest:v:${sha256Hex(`view:${practiceId}:${participant}`).slice(0, 16)}`;
}
