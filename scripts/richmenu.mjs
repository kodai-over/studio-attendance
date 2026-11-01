// LINEのリッチメニュー画像（2500×843、3つのカード型ボタン）を作る。
// 出力先の apps/liff/public/richmenu.png は GitHub Pages で配信され、Apps Script の setupRichMenu が読み込む。
// 実行: node scripts/richmenu.mjs
import { Resvg } from '@resvg/resvg-js';
import { existsSync, writeFileSync } from 'node:fs';

const W = 2500;
const H = 843;

// アプリのカラーパレット
const BG = '#0E0E10'; // リッチメニュー背景（落ち着いたダーク）
const CARD_BG_LIGHT = '#FFFFFF';
const CARD_STROKE_LIGHT = '#E4E4E0';
const CARD_BG_EMERALD = '#065F46'; // アプリのブランドグリーン（ブラウザで開くカード）
const CARD_STROKE_EMERALD = '#047857';

const font = (() => {
  const hira = ['W3', 'W6'].map((w) => `/System/Library/Fonts/ヒラギノ角ゴシック ${w}.ttc`);
  if (hira.every(existsSync)) return { files: hira, family: 'Hiragino Sans' };
  const noto = ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'];
  if (noto.every(existsSync)) return { files: noto, family: 'Noto Sans CJK JP' };
  return { files: ['/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'], family: 'IPAGothic' };
})();

// カードレイアウト（横3枚）
const padX = 40;
const padY = 40;
const gap = 30;
const cardH = H - padY * 2; // 763
const cardW = Math.floor((W - padX * 2 - gap * 2) / 3); // 786

const cards = [
  {
    x: padX,
    w: cardW,
    title: '予定確認',
    sub: '参加予定・回答の確認',
    isSpecial: false,
    // チェックマーク付きカレンダー（参考画像のテイスト）
    icon: `
      <!-- カレンダー上部ピン -->
      <line x1="-24" y1="-44" x2="-24" y2="-28" stroke="#111827" stroke-width="7" stroke-linecap="round"/>
      <line x1="24" y1="-44" x2="24" y2="-28" stroke="#111827" stroke-width="7" stroke-linecap="round"/>
      <!-- カレンダー枠（右下をチェックマーク用に開ける） -->
      <path d="M 16 -32 L -34 -32 A 12 12 0 0 0 -46 -20 L -46 26 A 12 12 0 0 0 -34 38 L 12 38" fill="none" stroke="#111827" stroke-width="7" stroke-linecap="round"/>
      <path d="M 46 -8 L 46 -20 A 12 12 0 0 0 34 -32 L 20 -32" fill="none" stroke="#111827" stroke-width="7" stroke-linecap="round"/>
      <!-- 日付グリッド -->
      <rect x="-32" y="-18" width="10" height="10" rx="3" fill="#111827"/>
      <rect x="-14" y="-18" width="10" height="10" rx="3" fill="#111827"/>
      <rect x="4" y="-18" width="10" height="10" rx="3" fill="#111827"/>
      <rect x="22" y="-18" width="10" height="10" rx="3" fill="#111827"/>
      <rect x="-32" y="2" width="10" height="10" rx="3" fill="#111827"/>
      <rect x="-14" y="2" width="10" height="10" rx="3" fill="#111827"/>
      <!-- チェックマーク -->
      <path d="M 14 18 L 26 30 L 48 8" fill="none" stroke="#111827" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    `,
  },
  {
    x: padX + cardW + gap,
    w: cardW,
    title: '予約登録',
    sub: 'スタジオ予約を追加',
    isSpecial: false,
    // カレンダー＋プラスアイコン
    icon: `
      <!-- カレンダー上部ピン -->
      <line x1="-24" y1="-44" x2="-24" y2="-28" stroke="#111827" stroke-width="7" stroke-linecap="round"/>
      <line x1="24" y1="-44" x2="24" y2="-28" stroke="#111827" stroke-width="7" stroke-linecap="round"/>
      <!-- カレンダー外枠 -->
      <rect x="-46" y="-32" width="92" height="76" rx="14" fill="none" stroke="#111827" stroke-width="7"/>
      <!-- ヘッダー区切り線 -->
      <line x1="-46" y1="-14" x2="46" y2="-14" stroke="#111827" stroke-width="5"/>
      <!-- 中央の大きなプラス -->
      <line x1="0" y1="-2" x2="0" y2="26" stroke="#111827" stroke-width="7" stroke-linecap="round"/>
      <line x1="-14" y1="12" x2="14" y2="12" stroke="#111827" stroke-width="7" stroke-linecap="round"/>
    `,
  },
  {
    x: padX + (cardW + gap) * 2,
    w: W - (padX + (cardW + gap) * 2) - padX, // 788
    title: 'ブラウザで開く',
    sub: 'Safari・Chromeで起動',
    isSpecial: true,
    // 外部ブラウザ飛び出しアイコン
    icon: `
      <!-- ウィンドウ枠 -->
      <rect x="-42" y="-42" width="84" height="84" rx="18" fill="none" stroke="#FFFFFF" stroke-width="7"/>
      <!-- 右上矢印 -->
      <path d="M-10 -24 L20 -24 L20 6 M20 -24 L-12 8" fill="none" stroke="#FFFFFF" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- 左下ウィンドウの残りの線 -->
      <path d="M-24 -8 L-24 18 A6 6 0 0 0 -18 24 L10 24" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/>
    `,
  },
];

const renderCard = (c) => {
  const bg = c.isSpecial ? CARD_BG_EMERALD : CARD_BG_LIGHT;
  const stroke = c.isSpecial ? CARD_STROKE_EMERALD : CARD_STROKE_LIGHT;
  const titleColor = c.isSpecial ? '#FFFFFF' : '#111827';
  const subColor = c.isSpecial ? 'rgba(255, 255, 255, 0.88)' : '#4B5563';
  const iconCircleBg = c.isSpecial ? 'rgba(255, 255, 255, 0.2)' : '#F3F4F6';
  const centerX = c.x + c.w / 2;

  return `
    <!-- カード背景 -->
    <rect x="${c.x}" y="${padY}" width="${c.w}" height="${cardH}" rx="36" fill="${bg}" stroke="${stroke}" stroke-width="4"/>

    <!-- タイトル -->
    <text x="${centerX}" y="${padY + 150}" text-anchor="middle" dominant-baseline="central" font-family="${font.family}" font-weight="700" font-size="68" fill="${titleColor}" letter-spacing="2">${c.title}</text>

    <!-- 丸アイコンバッジ -->
    <g transform="translate(${centerX} ${padY + 380})">
      <circle cx="0" cy="0" r="115" fill="${iconCircleBg}"/>
      <g transform="scale(1.25)">
        ${c.icon}
      </g>
    </g>

    <!-- サブテキスト（説明） -->
    <text x="${centerX}" y="${padY + 610}" text-anchor="middle" dominant-baseline="central" font-family="${font.family}" font-weight="500" font-size="36" fill="${subColor}" letter-spacing="1">${c.sub}</text>
  `;
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  ${cards.map(renderCard).join('\n')}
</svg>`;

const png = new Resvg(svg, { font: { fontFiles: font.files, loadSystemFonts: false, defaultFontFamily: font.family } }).render().asPng();
const out = new URL('../apps/liff/public/richmenu.png', import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} (${Math.round(png.length / 1024)} KB, ${font.family})`);
