import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { HomeView, MeView, PracticeView } from '@studio-attendance/shared';
import { api } from './api';
import { clientMode, initLiff, loginApp } from './liff';
import { createPracticeSyncTracker, mergePracticesWithKeep } from './pages/answerLogic';
import { AnswerPage } from './pages/Answer';
import { DetailPage } from './pages/Detail';
import { FeedbackPage } from './pages/Feedback';
import { HomePage } from './pages/Home';
import { syncPracticeNotices, updatePracticeSnapshot } from './pages/homeLogic';
import { ListPage } from './pages/List';
import { RecruitDetailPage } from './pages/RecruitDetail';
import { RecruitListPage } from './pages/RecruitList';
import { RegisterPage } from './pages/Register';
import { AdminPage, SettingsPage } from './pages/Settings';
import { resolveInitialHash } from './route';
import './styles.css';
import { initTheme } from './theme';
import { AppContext, FRESH_MS, NavBar, Spinner, go, useRoute, useToast } from './ui';

initTheme();

function Router() {
  const { path, query } = useRoute();
  if (path[0] === 'home') return <HomePage />;
  if (path[0] === 'p' && path[1]) return <DetailPage id={path[1]} focus={query.get('cal') === '1' ? 'calendar' : null} />;
  if (path[0] === 'answer') return <AnswerPage ids={query.getAll('r')} />;
  if (path[0] === 'recruit' && path[1]) return <RecruitDetailPage id={path[1]} />;
  if (path[0] === 'recruit') return <RecruitListPage />;
  if (path[0] === 'register') return <RegisterPage draftId={query.get('draft')} recruit={query.get('recruit') === '1'} />;
  if (path[0] === 'settings') return <SettingsPage />;
  if (path[0] === 'admin') return <AdminPage />;
  if (path[0] === 'feedback') return <FeedbackPage />;
  return <ListPage initialTab={query.get('tab')} />;
}

const CACHE_KEY = 'pb:home';

/** 前回開いたときの表示。開いた瞬間に出し、裏で最新に入れ替える */
function loadCache(): HomeView | null {
  try {
    if (localStorage.getItem('pb:loggedOut') === '1') return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as HomeView) : null;
  } catch {
    return null;
  }
}

function saveCache(h: HomeView) {
  try {
    // 別アカウント（一般・admin）として見ている内容は、キャッシュに保存しない
    if (h.me.actAs && h.me.actAs !== 'self') return;
    localStorage.setItem(CACHE_KEY, JSON.stringify(h));
  } catch {
    /* 保存できなくても動く */
  }
}

function App() {
  const [cached] = useState(loadCache);
  const [me, setMe] = useState<MeView | null>(cached?.me ?? null);
  const [practices, setPracticesState] = useState<{ list: PracticeView[]; at: number } | null>(cached ? { list: cached.practices, at: 0 } : null);
  const [error, setError] = useState<string | null>(null);
  const [startupFailed, setStartupFailed] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);
  const [toast, toastNode] = useToast();
  // 回答保存中（Infinity）や保存・編集直後（完了時刻）の練習。それより前に始まった一覧取得で戻さない
  const syncTracker = useRef(createPracticeSyncTracker());
  // 削除した（している）練習。あとから届いた一覧（削除より前に読んだもの）で戻さない
  const removed = useRef(new Set<string>());
  const clean = (list: PracticeView[]) => list.filter((v) => !removed.current.has(v.practice.id));
  // グループのカードから開いたときのグループと合言葉（読み込み直すときも、そのグループのメンバーとして覚えてもらう）
  const entry = useRef<{ group?: string; key?: string }>({});

  /** 起動時と同じまとめ取得。保存中や、この取得開始以降に更新された練習は、取得の結果で戻さない */
  const loadHome = async () => {
    const fetchStartedAt = Date.now();
    const home = await api('home', entry.current);
    // ステート更新関数の外で保護対象IDの算出と完了済みエントリの掃除を行う
    const keepIds = syncTracker.current.prepareMerge(fetchStartedAt);
    try {
      syncPracticeNotices(home.practices, home.me);
    } catch (err) {
      console.warn('syncPracticeNotices error in loadHome:', err);
    }
    setMe(home.me);
    setPracticesState((cur) => {
      const list = mergePracticesWithKeep(home.practices, cur?.list, keepIds);
      return { list: clean(list), at: Date.now() };
    });
    saveCache(home);
  };

  useEffect(() => {
    (async () => {
      const params = await initLiff();
      if (!params) {
        setLoggedOut(true);
        return;
      }
      // グループのカードから開いたときは、先にそのグループのメンバーとして覚えてもらう（でないと練習が見えない）
      const group = params.get('g');
      const key = params.get('k');
      if (group && key) entry.current = { group, key };

      const hash = resolveInitialHash(params, {
        currentHash: location.hash,
        isInClient: clientMode() === 'line',
      });
      if (hash) {
        history.replaceState(null, '', `${location.pathname}#${hash}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
      // グループのカードから開いたときは、そのグループのメンバーとして覚えてから一覧を返してもらう（問い合わせは1回だけ）
      await loadHome();
    })().catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      setStartupFailed(true);
      if (cached) toast(msg, true);
      else setError(msg);
    });
  }, []);

  // 別のアプリやタブから戻ってきたとき、一覧を取ってから時間がたっていれば裏で最新にする
  // （ホーム画面のアプリやブラウザのタブは、開いたまま何時間も置かれることがある）
  const fetchedAt = useRef(0);
  fetchedAt.current = practices?.at ?? 0;
  useEffect(() => {
    let syncing = false;
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || syncing) return;
      // 起動時のまとめ取得がまだ（失敗した）なら、起動の処理に任せる
      if (fetchedAt.current === 0 || Date.now() - fetchedAt.current < FRESH_MS) return;
      syncing = true;
      loadHome()
        .catch(() => {
          /* 戻ったときの取り直しは、失敗しても今の表示のままにする */
        })
        .finally(() => {
          syncing = false;
        });
    };
    document.addEventListener('visibilitychange', onReturn);
    // 戻るボタンでページごと戻ってきたとき（bfcache）
    window.addEventListener('pageshow', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('pageshow', onReturn);
    };
  }, []);

  // fresh でないときは取った時刻を変えない（前回の表示を「最新」と取り違えないように）
  const setPractices = (list: PracticeView[], fresh = false) => {
    const cleaned = clean(list);
    setPracticesState((cur) => ({
      list: cleaned,
      at: fresh ? Date.now() : (cur?.at ?? 0),
    }));
  };

  /** 確認したらすぐ一覧から消し、サーバーの返事は裏で待つ。失敗したらその練習だけ元に戻す */
  const deletePractice = async (v: PracticeView, opts?: { notifyGroups?: boolean }): Promise<boolean> => {
    const id = v.practice.id;
    removed.current.add(id);
    setPracticesState((cur) => cur && { ...cur, list: cur.list.filter((x) => x.practice.id !== id) });
    try {
      setPractices(await api('deletePractice', { id, notifyGroups: opts?.notifyGroups }), true);
      toast('削除しました');
      return true;
    } catch (e) {
      // 返事が届かなかっただけで、消えているかもしれない。取り直して、まだあるときだけ戻す
      let still: PracticeView = v;
      try {
        still = await api('getPractice', { id });
      } catch (e2) {
        // 「見つかりません」なら消えている。通信できなかったときは、押した時点の内容で戻す
        if (e2 instanceof Error && e2.message.includes('見つかりません')) {
          toast('削除しました');
          return true;
        }
      }
      removed.current.delete(id);
      const order = (x: PracticeView) => x.practice.date + x.practice.start;
      const back = still;
      setPracticesState((cur) =>
        cur && !cur.list.some((x) => x.practice.id === id) ? { ...cur, list: [...cur.list, back].sort((a, b) => order(a).localeCompare(order(b))) } : cur,
      );
      toast(`削除できませんでした（${e instanceof Error ? e.message : String(e)}）`, true);
      return false;
    }
  };
  const updatePractice = (v: PracticeView, { revert = false } = {}) => {
    // 削除した練習は、あとから届いた結果（取り直し・回答）で戻さない
    if (removed.current.has(v.practice.id)) return;
    // 失敗して元に戻したときは保護を外し、成功時は保存完了時刻を記録してその時刻以前に始まった取り直しから守る
    syncTracker.current.markUpdated(v.practice.id, revert);
    if (!revert && me) updatePracticeSnapshot(v, me);
    setPracticesState((cur) => {
      if (!cur) return cur;
      const has = cur.list.some((x) => x.practice.id === v.practice.id);
      return { ...cur, list: has ? cur.list.map((x) => (x.practice.id === v.practice.id ? v : x)) : [...cur.list, v] };
    });
  };
  const touchPractice = (id: string) => {
    // 保存処理開始時は Infinity をセットし、保存が終わるまで何回 loadHome が走っても戻されないようにする
    syncTracker.current.touchPractice(id);
  };
  const untouchPractice = (id: string) => {
    syncTracker.current.untouchPractice(id);
  };

  return (
    <div class="app">
      {loggedOut ? (
        <div class="empty signed-out">
          <strong>ログアウトしました</strong>
          <div>もう一度使うときは、LINEでログインしてください</div>
          <button class="btn primary" onClick={loginApp}>
            LINEでログイン
          </button>
        </div>
      ) : error ? (
        <div class="empty">{error}</div>
      ) : me ? (
        <AppContext.Provider value={{ me, setMe, toast, practices: practices?.list ?? null, practicesAt: practices?.at ?? 0, startupFailed, setPractices, updatePractice, touchPractice, untouchPractice, deletePractice, loadHome }}>
          {me.actAs && me.actAs !== 'self' && (
            <button class="acting-banner" onClick={() => go('/settings')}>
              {me.actAs === 'member' ? '一般として表示中' : '確認用アカウント「admin」として操作中'}（「自分」で戻せます）
            </button>
          )}
          <Router />
          <NavBar />
        </AppContext.Provider>
      ) : (
        <Spinner />
      )}
      {toastNode}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
