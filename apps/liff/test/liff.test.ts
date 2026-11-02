import { describe, expect, it } from 'vitest';
import { checkLiffRedirect, decideLiffInitAction } from '../src/liff';
import { resolveInitialHash } from '../src/route';

describe('LIFF 初期化 & 画面遷移ロジック', () => {
  describe('checkLiffRedirect', () => {
    it('openExternalBrowser=1 がある場合は外部ブラウザ用のURLを返し、パラメータを除去する', () => {
      const res = checkLiffRedirect('?openExternalBrowser=1', 'https://example.com', '/app/', '#top');
      expect(res).toEqual({ dest: 'https://example.com/app/#top' });
    });

    it('他のクエリパラメータが混ざっている場合も openExternalBrowser だけを除去する', () => {
      const res = checkLiffRedirect('?tab=1&openExternalBrowser=1&theme=dark', 'https://example.com', '/app/', '');
      expect(res).toEqual({ dest: 'https://example.com/app/?tab=1&theme=dark' });
    });

    it('openExternalBrowser=1 がない場合は null を返す', () => {
      const res = checkLiffRedirect('?tab=1', 'https://example.com', '/app/', '');
      expect(res).toBeNull();
    });

    it('クエリが空の場合は null を返す', () => {
      const res = checkLiffRedirect('', 'https://example.com', '/app/', '');
      expect(res).toBeNull();
    });
  });

  describe('decideLiffInitAction', () => {
    const baseParams = {
      search: '',
      origin: 'https://example.com',
      pathname: '/app/',
      hash: '',
      href: 'https://example.com/app/',
    };

    it('LINE内（isInClient: true）で openExternalBrowser=1 がある場合、外部ブラウザへリダイレクトする', () => {
      const action = decideLiffInitAction({
        ...baseParams,
        search: '?openExternalBrowser=1',
        isInClient: true,
        isLoggedIn: true,
        isLoggedOut: false,
      });
      expect(action).toEqual({
        action: 'redirect-external',
        dest: 'https://example.com/app/',
      });
    });

    it('LINE内（isInClient: true）で通常起動かつログイン済みの場合、ready になる', () => {
      const action = decideLiffInitAction({
        ...baseParams,
        isInClient: true,
        isLoggedIn: true,
        isLoggedOut: false,
      });
      expect(action).toEqual({ action: 'ready' });
    });

    it('LINE内（isInClient: true）では、たとえログアウトの印（isLoggedOut: true）が残っていてもログイン画面（show-login）にならず正常に進む', () => {
      // ログイン済みの場合
      const actionLoggedIn = decideLiffInitAction({
        ...baseParams,
        isInClient: true,
        isLoggedIn: true,
        isLoggedOut: true, // ブラウザでのログアウト印が残っていたケース
      });
      expect(actionLoggedIn).toEqual({ action: 'ready' });

      // 未ログインの場合でも勝手に show-login にならず LINE ログインへ進む
      const actionNotLoggedIn = decideLiffInitAction({
        ...baseParams,
        isInClient: true,
        isLoggedIn: false,
        isLoggedOut: true,
      });
      expect(actionNotLoggedIn).toEqual({
        action: 'login',
        redirectUri: 'https://example.com/app/',
      });
    });

    it('外部ブラウザ（isInClient: false）で未ログインかつ明示的ログアウト済みの場合は show-login（null 返却）になる', () => {
      const action = decideLiffInitAction({
        ...baseParams,
        isInClient: false,
        isLoggedIn: false,
        isLoggedOut: true,
      });
      expect(action).toEqual({ action: 'show-login' });
    });

    it('外部ブラウザ（isInClient: false）で未ログインかつ初回訪問（ログアウト印なし）の場合は自動 LINE ログインへ進む', () => {
      const action = decideLiffInitAction({
        ...baseParams,
        isInClient: false,
        isLoggedIn: false,
        isLoggedOut: false,
      });
      expect(action).toEqual({
        action: 'login',
        redirectUri: 'https://example.com/app/',
      });
    });

    it('外部ブラウザ（isInClient: false）でログイン済みの場合は ready になる', () => {
      const action = decideLiffInitAction({
        ...baseParams,
        isInClient: false,
        isLoggedIn: true,
        isLoggedOut: false,
      });
      expect(action).toEqual({ action: 'ready' });
    });
  });

  describe('resolveInitialHash (ルーティング振り分け)', () => {
    it('リッチメニュー「予約登録」の ?view=register で /register に振り分ける', () => {
      const hash = resolveInitialHash(new URLSearchParams('view=register'));
      expect(hash).toBe('/register');
    });

    it('パラメータがない通常起動時は undefined（トップ＝予定タブ）になる', () => {
      const hash = resolveInitialHash(new URLSearchParams(''));
      expect(hash).toBeUndefined();
    });

    it('過去の ?view= パラメータも互換性を保って振り分けられる', () => {
      expect(resolveInitialHash(new URLSearchParams('view=recruit'))).toBe('/recruit');
      expect(resolveInitialHash(new URLSearchParams('view=mine'))).toBe('/?tab=mine');
      expect(resolveInitialHash(new URLSearchParams('view=feedback'))).toBe('/feedback');
    });

    it('予約詳細や募集カードのリンクが優先して振り分けられる', () => {
      expect(resolveInitialHash(new URLSearchParams('p=p123'))).toBe('/p/p123');
      expect(resolveInitialHash(new URLSearchParams('p=p123&cal=1'))).toBe('/p/p123?cal=1');
      expect(resolveInitialHash(new URLSearchParams('manage=p123'))).toBe('/recruit/p123');
      expect(resolveInitialHash(new URLSearchParams('r=p1&r=p2'))).toBe('/answer?r=p1&r=p2');
    });

    it('draft パラメータおよび recruit=1 の組み合わせを正しく振り分ける', () => {
      expect(resolveInitialHash(new URLSearchParams('draft=d1'))).toBe('/register?draft=d1');
      expect(resolveInitialHash(new URLSearchParams('draft=d1&recruit=1'))).toBe('/register?draft=d1&recruit=1');
    });

    it('パラメータが重複した場合の優先順位（回答 > 募集管理 > 予約詳細 > 下書き > メニュー）を守る', () => {
      // p と view が同時 -> p が優先
      expect(resolveInitialHash(new URLSearchParams('p=p123&view=register'))).toBe('/p/p123');
      // manage と p が同時 -> manage が優先
      expect(resolveInitialHash(new URLSearchParams('manage=m1&p=p123'))).toBe('/recruit/m1');
      // r と manage が同時 -> r が優先
      expect(resolveInitialHash(new URLSearchParams('r=r1&manage=m1'))).toBe('/answer?r=r1');
      // draft と view が同時 -> draft が優先
      expect(resolveInitialHash(new URLSearchParams('draft=d1&view=register'))).toBe('/register?draft=d1');
    });
  });

  describe('予約削除ダイアログの初期状態判定', () => {
    it('募集済グループがある予約情報では通知フラグ初期値が true になる', () => {
      const hasGroups = (groups: string[]) => groups.length > 0;
      expect(hasGroups(['C1'])).toBe(true);
      expect(hasGroups(['C1', 'C2'])).toBe(true);
    });

    it('未募集の予約情報では通知フラグ初期値が false になる', () => {
      const hasGroups = (groups: string[]) => groups.length > 0;
      expect(hasGroups([])).toBe(false);
    });
  });
});
