// アプリのアイコン（ホーム画面に追加したときの絵）を PNG で書き出す。
// 黒地に白いチケット（アプリの「予約情報＝チケット」の見た目に合わせる）。
// 使い方: node apps/liff/scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

/** 0〜1 の座標で、その点が白（チケット）かどうか */
function white(x, y) {
  const L = 0.16, R = 0.84, T = 0.3, B = 0.7, r = 0.06;
  if (x < L || x > R || y < T || y > B) return false;
  // 角丸
  const cx = Math.min(Math.max(x, L + r), R - r);
  const cy = Math.min(Math.max(y, T + r), B - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return false;
  // 半券と本体のあいだの切り込み
  const sx = 0.4, nr = 0.055;
  if ((x - sx) ** 2 + (y - T) ** 2 < nr * nr || (x - sx) ** 2 + (y - B) ** 2 < nr * nr) return false;
  // 点線
  if (Math.abs(x - sx) < 0.008 && y > 0.37 && y < 0.63 && (y - 0.37) % 0.07 < 0.04) return false;
  // 本体の文字の代わりの2本線
  if (y > 0.425 && y < 0.46 && x > 0.48 && x < 0.76) return false;
  if (y > 0.54 && y < 0.575 && x > 0.48 && x < 0.66) return false;
  return true;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const SS = 4; // 縁をなめらかにするための細分割
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) if (white((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)) hit++;
      const v = Math.round((hit / (SS * SS)) * 255);
      const o = py * (size * 3 + 1) + 1 + px * 3;
      raw[o] = raw[o + 1] = raw[o + 2] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(resolve(out, name), png(size));
  console.log('wrote', name);
}
