export interface InitialRouteOptions {
  /** 起動時のハッシュ（location.hash） */
  currentHash?: string;
  /** LINE内アプリ（LIFFブラウザ）での起動か */
  isInClient?: boolean;
}

/**
 * 起動時のURLパラメータ（?p= / ?r= / ?view= 等）および起動環境から初期ハッシュルーティング先を解決する。
 * リッチメニューの「予約登録」（?view=register）や、募集カード・確認カードの遷移で使用される。
 * パラメータ指定がなく、既存の有効なハッシュもない場合：
 * - LINE内アプリ（isInClient: true、リッチメニュー「予定確認」等）では undefined（「予定」画面 `/` のまま）
 * - 通常ブラウザ・ホーム画面アプリ（isInClient: false）では `/home`（ホーム画面）へ振り分ける
 */
export function resolveInitialHash(params: URLSearchParams, opts?: InitialRouteOptions): string | undefined {
  const p = params.get('p');
  const manage = params.get('manage');
  const answers = params.getAll('r');
  const draft = params.get('draft');
  // ?view= はリッチメニューの「予約登録」（?view=register）や過去のリンクから各画面を開くのに使用
  const views: Record<string, string> = {
    home: '/home',
    schedule: '/',
    register: '/register',
    recruit: '/recruit',
    mine: '/?tab=mine',
    answer: '/answer',
    feedback: '/feedback',
  };
  const view = views[params.get('view') ?? ''];

  // 優先順位: 回答画面(?r=) > 募集詳細(?manage=) > 予約詳細(?p=) > 下書き登録(?draft=) > メニューリンク(?view=)
  const paramHash = answers.length
    ? `/answer?${answers.map((id) => `r=${encodeURIComponent(id)}`).join('&')}`
    : manage
      ? `/recruit/${encodeURIComponent(manage)}`
      : p
      ? `/p/${encodeURIComponent(p)}${params.get('cal') ? '?cal=1' : ''}`
      : draft
        ? `/register?draft=${encodeURIComponent(draft)}${params.get('recruit') === '1' ? '&recruit=1' : ''}`
        : view;

  if (paramHash) return paramHash;

  if (opts) {
    const cleanHash = (opts.currentHash ?? '').replace(/^#/, '');
    // すでに具体的なハッシュ（#/home や #/answer など）が指定されていればそのまま活かす
    if (cleanHash && cleanHash !== '/') return undefined;
    // LINE外のブラウザ・ホーム画面アプリでハッシュ未指定ならホーム画面を初期表示にする
    if (!opts.isInClient) return '/home';
  }

  return undefined;
}
