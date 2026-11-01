// 使う機能だけを読み込む（SDK を丸ごと読み込むより小さく、開くのが速い）
import liff from '@line/liff/core';
import CloseWindow from '@line/liff/close-window';
import GetContext from '@line/liff/get-context';
import GetIDToken from '@line/liff/get-id-token';
import GetProfile from '@line/liff/get-profile';
import IsInClient from '@line/liff/is-in-client';
import IsLoggedIn from '@line/liff/is-logged-in';
import Login from '@line/liff/login';
import Logout from '@line/liff/logout';
import OpenWindow from '@line/liff/open-window';
import Permission from '@line/liff/permission';
import SendMessages from '@line/liff/send-messages';
import { MOCK, configureAuth, markReady } from './api';

liff
  .use(new IsLoggedIn())
  .use(new Login())
  .use(new Logout())
  .use(new GetIDToken())
  .use(new GetProfile())
  .use(new IsInClient())
  .use(new OpenWindow())
  .use(new CloseWindow())
  .use(new GetContext())
  .use(new SendMessages())
  .use(new Permission());

const LIFF_ID = import.meta.env.VITE_LIFF_ID as string;

/** どこで開いているか。line: LINE内 / app: ホーム画面に追加したアプリ / browser: Safari などのブラウザ */
export type ClientMode = 'line' | 'app' | 'browser';

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

function setClientMode(inClient: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.client = inClient ? 'line' : isStandalone() ? 'app' : 'browser';
}

export const clientMode = (): ClientMode => (document.documentElement.dataset.client as ClientMode | undefined) ?? 'browser';

setClientMode(
  MOCK
    ? typeof location !== 'undefined' && (new URLSearchParams(location.search).get('inClient') === '1' || /\bLine\//i.test(navigator.userAgent))
    : typeof navigator !== 'undefined' && /\bLine\//i.test(navigator.userAgent),
);

/** ログアウトしたあと、勝手にログインし直さないための印（次に「ログイン」を押すまで残す） */
const LOGGED_OUT_KEY = 'pb:loggedOut';
const loggedOut = () => {
  try {
    return localStorage.getItem(LOGGED_OUT_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * LIFFを初期化し、未ログインならLINEログインへ。戻り値は起動時のURLパラメータ。
 * ブラウザでログアウトしたあとは、ログインの画面を出すため null を返す
 */
export async function initLiff(): Promise<URLSearchParams | null> {
  if (MOCK) {
    if (loggedOut()) return null;
  } else {
    await liff.init({ liffId: LIFF_ID });
    setClientMode(liff.isInClient());
    if (liff.isInClient()) {
      const sp = new URLSearchParams(location.search);
      if (sp.get('openExternalBrowser') === '1') {
        sp.delete('openExternalBrowser');
        const qs = sp.toString();
        const dest = `${location.origin}${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
        liff.openWindow({ url: dest, external: true });
        liff.closeWindow();
        return null;
      }
    }
    if (!liff.isLoggedIn()) {
      if (loggedOut() && !liff.isInClient()) return null;
      liff.login({ redirectUri: location.href });
      await new Promise(() => {}); // リダイレクトを待つ
    }
    // ログインできているなら、ログアウトの印は要らない
    try {
      localStorage.removeItem(LOGGED_OUT_KEY);
    } catch {
      /* 消せなくても動く */
    }
    configureAuth(
      () => liff.getIDToken(),
      () => {
        // 設定ミスで無限にログインし直さないよう、1回だけ試す
        if (sessionStorage.getItem('pb:relogin')) return;
        sessionStorage.setItem('pb:relogin', '1');
        liff.logout();
        liff.login({ redirectUri: location.href });
      },
    );
  }
  markReady();
  return new URLSearchParams(location.search);
}

/** カレンダーなどはLINEの外のブラウザで開く */
export function openExternal(url: string) {
  if (!MOCK && liff.isInClient()) liff.openWindow({ url, external: true });
  else window.open(url, '_blank', 'noopener');
}

export function closeApp() {
  if (!MOCK && liff.isInClient()) liff.closeWindow();
}

/** ブラウザ・ホーム画面のアプリでログアウトする。この端末に残した前回の表示も消す */
export function logoutApp() {
  try {
    localStorage.setItem(LOGGED_OUT_KEY, '1');
    localStorage.removeItem('pb:home');
    sessionStorage.removeItem('pb:relogin');
    sessionStorage.removeItem('pb:actAs');
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  } catch {
    /* 消せなくてもログアウトは続ける */
  }
  if (!MOCK && liff.isLoggedIn()) liff.logout();
  location.reload();
}

export interface UserProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

let cachedProfile: UserProfile | null = null;

/** LINEのプロフィール（アイコン画像・表示名）を取得 */
export async function getProfile(): Promise<UserProfile | null> {
  if (cachedProfile) return cachedProfile;
  if (MOCK) {
    cachedProfile = {
      userId: 'Ume',
      displayName: 'おおゆち',
      pictureUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
    };
    return cachedProfile;
  }
  try {
    if (liff.isLoggedIn()) {
      const p = await liff.getProfile();
      cachedProfile = {
        userId: p.userId,
        displayName: p.displayName,
        pictureUrl: p.pictureUrl,
      };
      return cachedProfile;
    }
  } catch (e) {
    console.warn('[getProfile error]', e);
  }
  return null;
}

/** ログアウトしたあとの画面から、LINEでログインし直す */
export function loginApp() {
  try {
    localStorage.removeItem(LOGGED_OUT_KEY);
  } catch {
    /* 消せなくてもログインは続ける */
  }
  if (MOCK) location.reload();
  else liff.login({ redirectUri: location.href.split('#')[0] });
}

/** カレンダーに追加する。iPhone の .ics は、ブラウザ・アプリでは同じ画面のまま開くと追加の画面がすぐ出る */
export function openCalendar(url: string, kind: 'ics' | 'google') {
  if (kind === 'ics' && clientMode() !== 'line') location.href = url;
  else openExternal(url);
}

/** iPhone・iPad・Mac なら iPhone のカレンダー（.ics）を先に出す */
export const prefersIcs = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

/**
 * スマホの共有の画面を開く。使えないときはリンクをコピーする。
 * 戻り値: shared（共有した）/ copied（コピーした）/ cancelled（閉じた）
 */
export async function shareLink(data: { title: string; text: string; url: string }): Promise<'shared' | 'copied' | 'cancelled'> {
  if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // 共有できない場所（LINE内の一部など）では、下のコピーに切り替える
    }
  }
  try {
    await navigator.clipboard.writeText(`${data.text}\n${data.url}`);
  } catch {
    prompt('共有するリンク', data.url);
  }
  return 'copied';
}

/**
 * 開いたトークに本人の発言として送れるか。送れるのはグループ（複数人トーク）から開いたときだけ。
 * noScope は LINE Developers で chat_message.write を有効にしていないとき
 */
export function canSendToChat(): 'ok' | 'outside' | 'noScope' {
  if (MOCK) return 'ok';
  if (!liff.isInClient()) return 'outside';
  const ctx = liff.getContext();
  if (ctx?.type !== 'group' && ctx?.type !== 'room') return 'outside';
  return ctx.scope?.includes('chat_message.write') ? 'ok' : 'noScope';
}

/** 開いたトークに、本人の発言として送る（LINE Developers で chat_message.write を有効にしておく） */
export async function sendToChat(text: string) {
  if (MOCK) {
    console.info('[mock sendMessages]', text);
    return;
  }
  // スコープを足す前にログインした人は、まだ許可していないことがある。そのときは先に許可を求める
  // 求められない設定のときもあるので、失敗してもそのまま送ってみる（送れなければ sendMessages が失敗する）
  const { state } = await liff.permission.query('chat_message.write').catch(() => ({ state: 'granted' }));
  if (state === 'prompt') await liff.permission.requestAll().catch((e) => console.error(e));
  await liff.sendMessages([{ type: 'text', text }]);
}
