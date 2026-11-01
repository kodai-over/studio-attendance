/** Botとの個別トークの下に出すメニュー（リッチメニュー）。画像は scripts/richmenu.mjs で作る 2500×843・ボタン1つ */
export const RICH_MENU_SIZE = { width: 2500, height: 843 };

/**
 * リッチメニューの定義。
 * 個別トークから直接Safari等の外部ブラウザで開くよう openExternalBrowser=1 を付与し、
 * トーク画面を邪魔しないよう初期状態は閉じた状態（バーのみ表示）にする。
 */
export function richMenuDefinition(appUrl: string) {
  // パス形式でスラッシュもクエリもハッシュもない場合は末尾スラッシュを補完してリダイレクト時のクエリ脱落を防ぐ
  const base = !appUrl.includes('?') && !appUrl.includes('#') && !appUrl.endsWith('/') ? `${appUrl}/` : appUrl;
  const uri = base.includes('openExternalBrowser=1') ? base : `${base}${base.includes('?') ? '&' : '?'}openExternalBrowser=1`;
  return {
    size: RICH_MENU_SIZE,
    selected: false,
    name: 'スタジオ練出欠管理 アプリ起動',
    chatBarText: 'アプリ起動',
    areas: [{ bounds: { x: 0, y: 0, ...RICH_MENU_SIZE }, action: { type: 'uri', label: 'アプリ起動', uri } }],
  };
}
