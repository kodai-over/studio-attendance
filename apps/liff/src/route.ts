/**
 * 起動時のURLパラメータ（?p= / ?r= / ?view= 等）から初期ハッシュルーティング先を解決する。
 * リッチメニューの「予約登録」（?view=register）や、募集カード・確認カードの遷移で使用される。
 */
export function resolveInitialHash(params: URLSearchParams): string | undefined {
  const p = params.get('p');
  const manage = params.get('manage');
  const answers = params.getAll('r');
  const draft = params.get('draft');
  // ?view= はリッチメニューの「予約登録」（?view=register）や過去のリンクから各画面を開くのに使用
  const views: Record<string, string> = { register: '/register', recruit: '/recruit', mine: '/?tab=mine', answer: '/answer', feedback: '/feedback' };
  const view = views[params.get('view') ?? ''];

  // 優先順位: 回答画面(?r=) > 募集詳細(?manage=) > 予約詳細(?p=) > 下書き登録(?draft=) > メニューリンク(?view=)
  return answers.length
    ? `/answer?${answers.map((id) => `r=${encodeURIComponent(id)}`).join('&')}`
    : manage
      ? `/recruit/${encodeURIComponent(manage)}`
      : p
      ? `/p/${encodeURIComponent(p)}${params.get('cal') ? '?cal=1' : ''}`
      : draft
        ? `/register?draft=${encodeURIComponent(draft)}${params.get('recruit') === '1' ? '&recruit=1' : ''}`
        : view;
}
