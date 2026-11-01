// LINEのリッチメニュー画像（2500×843、中央にスリムなピル型ボタン）を作る。
// 出力先の apps/liff/public/richmenu.png は GitHub Pages で配信され、Apps Script の setupRichMenu が読み込む。
// 実行: node scripts/richmenu.mjs（macOS ならヒラギノ角ゴシック、なければ IPA/Noto のゴシックを使う）
import { Resvg } from '@resvg/resvg-js';
import { existsSync, writeFileSync } from 'node:fs';

const W = 2500;
const H = 843;
const BG = '#0a0a0a';
const BTN_BG = '#1a1a1c';
const BORDER = '#333336';
const INK = '#FFFFFF';

// 外部ブラウザ・独立アプリの起動を表すアイコン（角丸ウィンドウと右上飛び出し矢印）
const ICON = 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3';
const LABEL = 'アプリ起動';

const font = (() => {
  const hira = ['W3', 'W6'].map((w) => `/System/Library/Fonts/ヒラギノ角ゴシック ${w}.ttc`);
  if (hira.every(existsSync)) return { files: hira, family: 'Hiragino Sans' };
  const noto = ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'];
  if (noto.every(existsSync)) return { files: noto, family: 'Noto Sans CJK JP' };
  return { files: ['/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'], family: 'IPAGothic' };
})();

// 中央に配置するスリムなカプセル型ボタンのサイズ
const btnW = 1520;
const btnH = 440;
const btnX = (W - btnW) / 2;
const btnY = (H - btnH) / 2;
const btnR = btnH / 2;

const SCALE = 9.5; // 24×9.5 = 228px
const FONT_SIZE = 126;
const GAP = 72;
const textW = LABEL.length * FONT_SIZE;
const contentW = 24 * SCALE + GAP + textW;
const startX = (W - contentW) / 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <!-- スリムなピル型ボタン枠 -->
  <rect x="${btnX}" y="${btnY}" width="${btnW}" height="${btnH}" rx="${btnR}" fill="${BTN_BG}" stroke="${BORDER}" stroke-width="5"/>
  <!-- 外部ブラウザ起動アイコン -->
  <g transform="translate(${startX} ${H / 2 - 12 * SCALE}) scale(${SCALE})" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="${ICON}"/>
  </g>
  <!-- テキスト -->
  <text x="${startX + 24 * SCALE + GAP}" y="${H / 2 + 5}" dominant-baseline="central" font-family="${font.family}" font-weight="600" font-size="${FONT_SIZE}" fill="${INK}" letter-spacing="4">${LABEL}</text>
</svg>`;

const png = new Resvg(svg, { font: { fontFiles: font.files, loadSystemFonts: false, defaultFontFamily: font.family } }).render().asPng();
const out = new URL('../apps/liff/public/richmenu.png', import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} (${Math.round(png.length / 1024)} KB, ${font.family})`);
