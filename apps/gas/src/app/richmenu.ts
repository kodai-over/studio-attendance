/** Botとの個別トークの下に出すメニュー（リッチメニュー）。画像は scripts/richmenu.mjs で作る 2500×843・3つのカードボタン */
export const RICH_MENU_SIZE = { width: 2500, height: 843 };

/**
 * リッチメニューの定義。
 * 1. 予定確認: LINE内アプリ（トップ＝予定タブ）を起動
 * 2. 予約登録: LINE内アプリ（予約登録画面）を起動
 * 3. ブラウザで開く: Safari・Chrome等の外部ブラウザで全画面起動（openExternalBrowser=1）
 */
export function richMenuDefinition(appUrl: string, liffId?: string) {
  // パス形式でスラッシュもクエリもハッシュもない場合は末尾スラッシュを補完してリダイレクト時のクエリ脱落を防ぐ
  const base = !appUrl.includes('?') && !appUrl.includes('#') && !appUrl.endsWith('/') ? `${appUrl}/` : appUrl;
  const externalUri = base.includes('openExternalBrowser=1') ? base : `${base}${base.includes('?') ? '&' : '?'}openExternalBrowser=1`;

  const liffBase = liffId ? `https://liff.line.me/${liffId}` : appUrl;
  const scheduleUri = liffBase;
  const registerUri = `${liffBase}${liffBase.includes('?') ? '&' : '?'}view=register`;

  const w1 = 833;
  const w2 = 834;
  const w3 = 833;
  const h = RICH_MENU_SIZE.height;

  return {
    size: RICH_MENU_SIZE,
    selected: false,
    name: 'スタジオ練出欠管理 メニュー',
    chatBarText: 'メニュー',
    areas: [
      { bounds: { x: 0, y: 0, width: w1, height: h }, action: { type: 'uri', label: '予定確認', uri: scheduleUri } },
      { bounds: { x: w1, y: 0, width: w2, height: h }, action: { type: 'uri', label: '予約登録', uri: registerUri } },
      { bounds: { x: w1 + w2, y: 0, width: w3, height: h }, action: { type: 'uri', label: 'ブラウザで開く', uri: externalUri } },
    ],
  };
}
