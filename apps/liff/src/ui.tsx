import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { canRegister, computeCancelDeadline, isActive, isHoliday, isPastPractice, labelDate, shouldNotifyPracticeCancellation, toJstDate, toJstTime, weekday, yen, type Answer, type MeView, type PracticeView } from '@studio-attendance/shared';
import { getUnansweredSummary } from './pages/answerLogic';
import { HOME_READ_EVENT, getHomeUnreadStatus } from './pages/homeLogic';
import { applyTheme, getTheme, type ThemeMode } from './theme';

// ---------------------------------------------------------------- ルーティング（ハッシュ）

export function parseHash(): { path: string[]; query: URLSearchParams } {
  const [p, q = ''] = location.hash.replace(/^#/, '').split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

export type NavigationGuard = (toPath: string) => boolean;
let currentGuard: NavigationGuard | null = null;

export function setNavigationGuard(guard: NavigationGuard | null) {
  currentGuard = guard;
}

/**
 * hashchange 発生時（ブラウザやLINEの「戻る」等）のナビゲーションガード判定。
 * キャンセルされた場合は history.replaceState で履歴を増やさず・再度の hashchange を起こさずに元のハッシュへ戻す。
 */
export function handleHashChangeGuard(oldURL?: string): {
  allowed: boolean;
  parsed: { path: string[]; query: URLSearchParams };
} {
  const newParsed = parseHash();
  const toPath = '/' + newParsed.path.join('/');
  if (currentGuard && !currentGuard(toPath)) {
    let oldHash = '#/';
    if (oldURL) {
      try {
        const base = typeof location !== 'undefined' && location.href ? location.href : 'http://localhost/';
        oldHash = new URL(oldURL, base).hash || '#/';
      } catch {
        const idx = oldURL.indexOf('#');
        oldHash = idx >= 0 ? oldURL.slice(idx) : '#/';
      }
    }
    if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
      history.replaceState(null, '', oldHash);
    } else {
      location.hash = oldHash;
    }
    return { allowed: false, parsed: parseHash() };
  }
  return { allowed: true, parsed: newParsed };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = (e: HashChangeEvent) => {
      const { allowed, parsed } = handleHashChangeGuard(e.oldURL);
      if (!allowed) return;
      setRoute(parsed);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path: string) => {
  if (currentGuard && !currentGuard(path)) return;
  location.hash = path;
};

// ---------------------------------------------------------------- 共有の状態

interface AppState {
  me: MeView;
  setMe(me: MeView): void;
  toast(msg: string, error?: boolean): void;
  /** 練習の一覧。起動時にまとめて取ったもの（前回の表示のときは practicesAt が 0） */
  practices: PracticeView[] | null;
  practicesAt: number;
  /** 起動時のまとめ取得に失敗した（practicesAt が 0 のまま最新が来ない） */
  startupFailed: boolean;
  /** 一覧を置き換える。fresh なら「今取った最新」として扱う（一覧に戻っても取り直さない） */
  setPractices(list: PracticeView[], fresh?: boolean): void;
  /** 1件だけ差し替える（回答や修正の結果をすぐ一覧に反映する） */
  updatePractice(v: PracticeView, opts?: { revert?: boolean }): void;
  /** 回答操作中の練習をマークし、一覧の再取得で上書き・巻き戻されないよう保護する */
  touchPractice(id: string): void;
  /** 回答保存失敗時などに練習の保護マークを解除する */
  untouchPractice?(id: string): void;
  /** 練習を削除する（すぐ一覧から消し、失敗したら戻す）。消せたら true */
  deletePractice(v: PracticeView, opts?: { notifyGroups?: boolean }): Promise<boolean>;
  /** 起動時と同じまとめ取得をやり直す（グループのカードから開いたときは、そのグループのメンバーとしても覚えてもらう） */
  loadHome(): Promise<void>;
}

/** 一覧を取ってからこの時間内なら、最新とみなして取り直さない */
export const FRESH_MS = 60_000;

export const AppContext = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(AppContext);

export function useToast() {
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 4000 : 2200);
    return () => clearTimeout(t);
  }, [toast]);
  const show = useCallback((msg: string, error = false) => setToast({ msg, error }), []);
  const node = toast ? (
    <div class={`toast${toast.error ? ' error' : ''}`} role="status">
      {toast.msg}
    </div>
  ) : null;
  return [show, node] as const;
}

/** 非同期処理を実行し、失敗したらトーストで知らせる */
export function useRunner() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, done?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (done) toast(done);
        return r;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), true);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return [run, busy] as const;
}

// ---------------------------------------------------------------- アイコン（線画。色は文字色に合わせる）

const ICONS = {
  ticket: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4zM15 6v2M15 11v2M15 16v2',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12 20 4l-6 16-3-7zM11 13l9-9',
  chat: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V17h0a2 2 0 0 1-2-2z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2.5h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  text: 'M5 6h14M5 10h14M5 14h9M5 18h6',
  x: 'M6 6l12 12M18 6 6 18',
  calendar: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8 3v4M16 3v4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 19.5c.8-3 3.3-4.5 6.5-4.5s5.7 1.5 6.5 4.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 15.2c1.7.6 3 2 3.5 4.3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  pin: 'M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  note: 'M6 3.5h9l4 4v13H6zM14.5 3.5V8H19M9 12.5h7M9 16h5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  check: 'M5 12.5 10 17.5 19 7',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6',
  share: 'M12 14.5V3.5M8 7.5l4-4 4 4M6 11H5v9.5h14V11h-1',
  logout: 'M14 4.5H5.5v15H14M10 12h10M16.5 8.5 20 12l-3.5 3.5',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4',
  home: 'M4 11 12 4l8 7M6.5 9.5V20h11V9.5',
  sun: 'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  device: 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 17h.01',
} as const;
export type IconName = keyof typeof ICONS;

export const Icon = ({ name, size = 22 }: { name: IconName; size?: number }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={ICONS[name]} />
  </svg>
);

// ---------------------------------------------------------------- 部品

export const Spinner = () => <div class="spinner" aria-label="読み込み中" />;

/** 裏で最新に入れ替えている間、画面上端に細い線を流す */
export const Syncing = () => <div class="syncing" role="progressbar" aria-label="更新中" />;

/** ヘッダー右上に配置する外観（ライト/ダーク）切り替えボタン */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(() => getTheme());
  const toggle = () => {
    const isDark =
      document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    const next: ThemeMode = isDark ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  return (
    <button class="icon-btn theme-toggle-btn" aria-label={`外観テーマ切り替え（現在: ${isDark ? 'ダーク' : 'ライト'}）`} onClick={toggle} title="外観切り替え">
      <Icon name={isDark ? 'sun' : 'moon'} size={19} />
    </button>
  );
}

/**
 * 画面上部のバー。メニューから開く画面（戻るがない画面）は大きい見出しを出し、
 * 見出しがバーの下に隠れたら、バーの中央に小さく出す
 */
export function TopBar({
  title,
  back,
  onBack,
  children,
  showTheme,
}: {
  title?: string;
  back?: boolean;
  onBack?: () => void;
  children?: ComponentChildren;
  showTheme?: boolean;
}) {
  const large = !!title && !back;
  const barRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const bar = barRef.current;
      if (!bar) return;
      const heading = titleRef.current;
      const barBottom = bar.getBoundingClientRect().bottom;
      setScrolled(heading ? heading.getBoundingClientRect().bottom <= barBottom : window.scrollY > 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!title && !back && children === undefined && !showTheme) return null;
  return (
    <>
      <header ref={barRef} class={`topbar${large ? ' has-large' : ''}${scrolled ? ' scrolled' : ''}`}>
        {back && (
          <button
            class="back-btn"
            aria-label="戻る"
            onClick={() => {
              if (onBack) onBack();
              else if (history.length > 1) history.back();
              else go('/');
            }}
          >
            <Icon name="back" size={24} />
          </button>
        )}
        {title &&
          (large ? (
            <div class="topbar-title" aria-hidden="true">
              {title}
            </div>
          ) : (
            <h1 class="topbar-title">{title}</h1>
          ))}
        <div class="topbar-actions">
          {children}
          {showTheme && <ThemeToggle />}
        </div>
      </header>
      {large && (
        <h1 ref={titleRef} class="large-title">
          {title}
        </h1>
      )}
    </>
  );
}

/** 画面上部の文字タブ（下線と縦の区切りだけで切り替える） */
export function Tabs<K extends string>({ items, value, onChange }: { items: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div class="tabs" role="tablist">
      {items.map((t) => (
        <button role="tab" aria-selected={t.key === value} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count != null && <span class="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** 画面下のナビゲーションから現在地のタブキーを解決する */
export function resolveActiveNavKey(path: string[]): string {
  const first = path[0] ?? '';
  if (first === 'p') return '';
  if (first === 'register') return 'recruit';
  if (first === 'admin' || first === 'feedback') return 'settings';
  return first;
}

/**
 * 下にスクロールしている間は true、上に戻したり画面の上端近くに来たら false。
 * 指の細かな揺れで出たり消えたりしないよう、少し動いてから切り替える
 */
export function useHideOnScroll(threshold = 8) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let ticking = false;
    let state = false;
    // 切り替えた直後は、隠したことで高さが変わって起きるスクロールを向きとして扱わない（出る・隠れるの繰り返しを防ぐ）
    let quietUntil = 0;
    const set = (v: boolean) => {
      if (v === state) return;
      state = v;
      quietUntil = performance.now() + 400;
      setHidden(v);
    };
    const update = () => {
      ticking = false;
      const y = window.scrollY;
      // 画面の上端近くでは、いつでも出す
      if (y < 48) {
        set(false);
        last = y;
        return;
      }
      if (performance.now() < quietUntil) {
        last = y;
        return;
      }
      const dy = y - last;
      const atBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 2;
      if (dy > threshold && !atBottom) set(true);
      else if (dy < -threshold) set(false);
      else return;
      last = y;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return hidden;
}

const PULL_TRIGGER = 64;
const PULL_MAX = 96;

/**
 * 画面の一番上で下に引っ張ると、最新を取り直す。
 * 引いた量に合わせて丸い印が下りてきて回り、一定以上引いて離すと更新する
 */
export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const { toast } = useApp();
  const [pull, setPull] = useState(0);
  const [loading, setLoading] = useState(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    const st = { startY: 0, active: false, pull: 0, loading: false };
    const start = (e: TouchEvent) => {
      if (st.loading || window.scrollY > 0 || e.touches.length !== 1) return;
      st.startY = e.touches[0].clientY;
      st.active = true;
      st.pull = 0;
    };
    const move = (e: TouchEvent) => {
      if (!st.active) return;
      const dy = e.touches[0].clientY - st.startY;
      st.pull = dy <= 0 || window.scrollY > 0 ? 0 : Math.min(PULL_MAX, dy * 0.5);
      setPull(st.pull);
    };
    const end = async () => {
      if (!st.active) return;
      st.active = false;
      if (st.pull < PULL_TRIGGER) {
        st.pull = 0;
        setPull(0);
        return;
      }
      st.loading = true;
      setLoading(true);
      setPull(PULL_TRIGGER);
      try {
        await refresh.current();
      } catch {
        toast('更新できませんでした。もう一度試してください', true);
      } finally {
        st.loading = false;
        st.pull = 0;
        setLoading(false);
        setPull(0);
      }
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, []);

  if (pull === 0 && !loading) return null;
  const progress = Math.min(1, pull / PULL_TRIGGER);
  return (
    <div class="ptr" role="status" aria-label={loading ? '更新中' : '離すと更新'} style={{ '--pull': `${pull}px`, '--progress': progress }}>
      <span class={`ptr-ring${loading ? ' spinning' : ''}`} />
    </div>
  );
}

/** 画面下のナビゲーション。どの画面からでも主要画面に移れる */
export function NavBar() {
  const { me, practices } = useApp();
  const { path } = useRoute();
  const [readTick, setReadTick] = useState(0);

  useEffect(() => {
    const onRead = () => setReadTick((x) => x + 1);
    window.addEventListener(HOME_READ_EVENT, onRead);
    return () => window.removeEventListener(HOME_READ_EVENT, onRead);
  }, []);

  const { todoCount, homeBadgeCount } = useMemo(() => {
    const now = new Date();
    const today = toJstDate(now);
    const currentTime = toJstTime(now);
    const { totalCount } = getUnansweredSummary(practices, me, today, currentTime);
    const { totalBadgeCount } = getHomeUnreadStatus(practices, me, today, currentTime);
    return { todoCount: totalCount, homeBadgeCount: totalBadgeCount };
  }, [practices, me, readTick]);

  const items: { to: string; key: string; icon: IconName; label: string; badge?: number }[] = [
    { to: '/home', key: 'home', icon: 'home', label: 'ホーム', badge: homeBadgeCount },
    { to: '/', key: '', icon: 'ticket', label: '予定' },
    ...(canRegister(me.member) ? ([{ to: '/recruit', key: 'recruit', icon: 'send', label: '募集' }] as const) : []),
    { to: '/answer', key: 'answer', icon: 'check', label: 'RSVP', badge: todoCount },
    { to: '/settings', key: 'settings', icon: 'user', label: 'アカウント' },
  ];
  const active = resolveActiveNavKey(path);
  const hidden = useHideOnScroll();
  // 上のバーや予定のタブも同じ合図で動かすため、画面全体に印を付ける
  useEffect(() => {
    if (hidden) document.documentElement.dataset.chrome = 'hidden';
    else delete document.documentElement.dataset.chrome;
  }, [hidden]);
  useEffect(() => () => void delete document.documentElement.dataset.chrome, []);
  return (
    <nav class={`navbar${hidden ? ' is-hidden' : ''}`}>
      {items.map((it) => (
        <button aria-current={active === it.key ? 'page' : undefined} onClick={() => go(it.to)}>
          <span class="nav-icon">
            <Icon name={it.icon} size={24} />
            {it.badge != null && it.badge > 0 && <span class="count-badge">{it.badge}</span>}
          </span>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

const dayClassOf = (date: string) => {
  const w = weekday(date);
  return isHoliday(date) || w === '日' ? 'sun' : w === '土' ? 'sat' : 'weekday';
};

/** チケットの日付。行くと決めた予約情報は反転する */
export function Stub({ date, onClick }: { date: string; onClick?: () => void }) {
  const [, m, d] = date.split('-').map(Number);
  return (
    <div class={`stub ${dayClassOf(date)}`} aria-hidden="true" onClick={onClick}>
      <span class="m">{m}月</span>
      <span class="d">{d}</span>
      <span class="w">{weekday(date)}</span>
    </div>
  );
}

export function StatusBadge({ v }: { v: { practice: { status: string } } | PracticeView }) {
  const s = v.practice.status;
  if (s === '中止') return <span class="label danger">中止</span>;
  if (s === '満員') return <span class="label">満員</span>;
  return null;
}

const ANSWER_MARK: Record<Answer, string> = { 行く: '○', 保留: '△', 行かない: '✕' };
/** 画面に出す回答の名前（シートの値は「保留」のまま、画面では「未定」と出す） */
export const ANSWER_LABEL: Record<Answer, string> = { 行く: '行く', 保留: '未定', 行かない: '行かない' };

/** 回答ボタン。文字は出さず、日本の回答表どおり ○ △ ✕ の記号だけで選ぶ */
export function RsvpButtons({
  value,
  status,
  onAnswer,
  onClear,
  onBlocked,
  busy,
  solo,
}: {
  value: Answer | null;
  status: string;
  onAnswer: (a: Answer) => void;
  /** 選んでいる記号をもう一度押したとき（未回答に戻す）。なければ何もしない */
  onClear?: () => void;
  /** 満員や締切などで選択がブロックされたときの通知コールバック */
  onBlocked?: (reason: 'full' | 'closed') => void;
  busy?: boolean;
  /** チケットの外に単独で置く（大きなボタンにする） */
  solo?: boolean;
}) {
  const closed = status === '中止' || status === '終了';
  const full = status === '満員' && value !== '行く';
  return (
    <div class={`rsvp${solo ? ' solo' : ''}`} role="radiogroup" aria-label="回答">
      {(['行く', '保留', '行かない'] as const).map((a) => {
        const isGoingBlocked = a === '行く' && full;
        return (
          <button
            type="button"
            role="radio"
            class={`${a === '行く' ? 'yes' : a === '保留' ? 'maybe' : 'no'}${isGoingBlocked ? ' is-blocked-full' : ''}`}
            aria-checked={value === a}
            aria-label={isGoingBlocked ? '満員（選択不可）' : ANSWER_LABEL[a]}
            title={isGoingBlocked ? '満員のため「行く」は選べません' : ANSWER_LABEL[a]}
            disabled={busy || closed}
            onClick={() => {
              if (isGoingBlocked) {
                onBlocked?.('full');
                return;
              }
              if (value !== a) onAnswer(a);
              else onClear?.();
            }}
          >
            <span class="mark" aria-hidden="true">
              {ANSWER_MARK[a]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 名前の頭文字の丸。ゲストは点線 */
export const Avatar = ({ name, guest }: { name: string; guest?: boolean }) => (
  <span class={`avatar${guest ? ' guest' : ''}`} aria-hidden="true">
    {[...name.trim()][0] ?? '?'}
  </span>
);

/** 予約情報のパス（詳細・参加リンクの画面の先頭）。大きな日付と、ラベルと値の並び */
export function Pass({
  date,
  status,
  fields,
}: {
  date: string;
  status: string;
  fields: { label: string; value: ComponentChildren; note?: string | null; wide?: boolean }[];
}) {
  const [, m, d] = date.split('-').map(Number);
  const dayClass = dayClassOf(date);
  return (
    <section class="pass" data-status={status}>
      <div class="pass-head">
        <h2 class="pass-date">
          {m}月{d}日<span class={`w ${dayClass}`}>（{weekday(date)}）</span>
        </h2>
        <StatusBadge v={{ practice: { status } }} />
      </div>
      <div class="pass-grid">
        {fields.map((f) => (
          <div class={`fld${f.wide ? ' wide' : ''}`}>
            <span>{f.label}</span>
            <b>{f.value}</b>
            {f.note && <small>{f.note}</small>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** 時間のかかる処理の間、画面を覆って操作できないようにする */
export function BusyOverlay({ message, note }: { message: string; note?: string }) {
  return (
    <div class="overlay" role="alertdialog" aria-busy="true" aria-label={message}>
      <div class="dialog center">
        <div class="spinner" />
        <h3>{message}</h3>
        {note && <p class="muted">{note}</p>}
      </div>
    </div>
  );
}

/** 一覧のチケットの金額。スタジオ代だけを出す（1人あたりは詳細の画面で） */
export const Fee = ({ v }: { v: PracticeView }) => (
  <span class="fee">
    {yen(v.practice.fee)}
  </span>
);

export const place = (p: { studio: string; room: string }) => `${p.studio}${p.room ? ' ' + p.room : ''}`;

/** 共有の画面に渡す文。日時と場所を先に書き、参加リンクから回答できると添える */
export const shareData = (v: PracticeView, url: string) => ({
  title: 'スタジオ練出欠管理',
  text: `${labelDate(v.practice.date)} ${v.practice.start}–${v.practice.end} ${place(v.practice)}\n参加リンクから回答できます`,
  url,
});

/** チケットに出すキャンセル期限。間近は色を付け、過ぎたら薄く「超過」と出す */
export function CancelDeadlineBadge({ date, studio }: { date: string; studio: string }) {
  const { me } = useApp();
  const deadline = computeCancelDeadline(date, studio, me?.settings?.cancelRules ?? []);
  if (!deadline) return null;

  return (
    <span class={`deadline${deadline.isSoon ? ' is-soon' : ''}${deadline.isPast ? ' is-past' : ''}`}>
      <Icon name="clock" size={13} />
      <span>{deadline.isPast ? 'キャンセル期限超過' : `キャンセル期限 ${deadline.formatted}`}</span>
    </span>
  );
}

/** 予約情報削除の確認で、グループへの削除の連絡チェックの初期値を決める（終了済・中止・未募集は false） */
export function shouldNotifyInitially(
  v: PracticeView | null,
  today = toJstDate(new Date()),
  currentTime = toJstTime(new Date()),
): boolean {
  return shouldNotifyPracticeCancellation(v ? v.practice : null, today, currentTime);
}

/** 予約情報削除の確認。募集済グループへの削除の連絡オプション付き */
export function DeleteConfirmDialog({
  view: v,
  onClose,
  onConfirm,
  busy,
}: {
  view: PracticeView | null;
  onClose: () => void;
  onConfirm: (notifyGroups: boolean) => Promise<unknown> | void;
  busy?: boolean;
}) {
  const now = new Date();
  const today = toJstDate(now);
  const currentTime = toJstTime(now);
  const canNotify = shouldNotifyInitially(v, today, currentTime);
  const [notify, setNotify] = useState(canNotify);

  useEffect(() => {
    setNotify(canNotify);
  }, [v?.practice.id, canNotify]);

  if (!v) return null;
  const p = v.practice;
  const answered = v.goingCount + v.maybe.length;
  const isPast = isPastPractice(p, today, currentTime);
  const isCanceled = !isActive(p);

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="予約情報の削除">
      <div class="dialog">
        <h3>予約情報を削除</h3>
        <p>
          <b>{labelDate(p.date)} {p.start}〜{p.end}</b>
          <br />
          {place(p)}
        </p>
        <p class="muted">
          {answered > 0 ? `回答している人がいます（行く${v.goingCount}人・未定${v.maybe.length}人）。回答も一緒に削除されます。` : 'この予約情報を削除します。'}
        </p>

        {canNotify ? (
          <label class="check">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify((e.target as HTMLInputElement).checked)} disabled={busy} />
            <span>募集済のグループに削除の連絡を送る</span>
          </label>
        ) : (
          <p class="muted">
            {isPast
              ? '終了した予約情報なので、グループへの削除の連絡は送られません。'
              : isCanceled
              ? '中止済の予約情報なので、グループへの削除の連絡は送られません。'
              : 'まだグループに募集していないので、グループへの削除の連絡は送られません。'}
          </p>
        )}

        <div class="btn-row">
          <button class="btn" onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button class="btn danger" onClick={() => onConfirm(canNotify && notify)} disabled={busy}>
            {busy ? '削除中…' : '削除する'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 読み取り中のオーバーレイ（スクショ・文章） */
export function ParsingProgressOverlay({ kind }: { kind: 'image' | 'text' }) {
  return <BusyOverlay message="予約内容を読み取り中" note={kind === 'image' ? 'スクショから日時・スタジオ・スタジオ代を読み取っています' : '文章から日時・スタジオ・スタジオ代を読み取っています'} />;
}
