import { describe, expect, it, vi } from 'vitest';
import type { PracticeView } from '@studio-attendance/shared';
import {
  clearGlobalDrafts,
  createPracticeSyncTracker,
  createRsvpNavigationGuard,
  executeStageAnswer,
  generateSpecificReport,
  globalDrafts,
  mergePracticesWithKeep,
  recordSpecificChange,
  type SpecificChangeMap,
} from '../src/pages/answerLogic';
import { MyAnswerBadge, readTab } from '../src/pages/List';
import { resolveInitialHash } from '../src/route';
import { RsvpButtons, go, handleHashChangeGuard, parseHash, setNavigationGuard } from '../src/ui';

describe('MyAnswerBadge（予定一覧・詳細の回答ステータスバッジ）', () => {
  it('行く（○）のバッジが正しく返る', () => {
    const vnode = MyAnswerBadge({ answer: '行く' });
    expect(vnode.props['aria-label']).toBe('行く');
    expect(vnode.props.children).toBe('○');
    expect(vnode.props.class).toContain('going');
  });

  it('保留（△）のバッジが正しく返る', () => {
    const vnode = MyAnswerBadge({ answer: '保留' });
    expect(vnode.props['aria-label']).toBe('未定');
    expect(vnode.props.children).toBe('△');
    expect(vnode.props.class).toContain('maybe');
  });

  it('行かない（✕）のバッジが正しく返る', () => {
    const vnode = MyAnswerBadge({ answer: '行かない' });
    expect(vnode.props['aria-label']).toBe('行かない');
    expect(vnode.props.children).toBe('✕');
    expect(vnode.props.class).toContain('not-going');
  });

  it('未回答（—）のバッジが正しく返る', () => {
    const vnode = MyAnswerBadge({ answer: null });
    expect(vnode.props['aria-label']).toBe('未回答');
    expect(vnode.props.children).toBe('—');
    expect(vnode.props.class).toContain('none');
  });
});

describe('readTab（予定一覧タブの互換性維持）', () => {
  it('古い未定タブ（todo）が残っていても、安全に「all（すべて）」へ戻す', () => {
    const store = new Map<string, string>();
    const originalLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      length: 0,
      key: () => null,
    };

    try {
      localStorage.setItem('pb:tab', 'todo');
      expect(readTab()).toBe('all');

      localStorage.setItem('pb:tab', 'mine');
      expect(readTab()).toBe('mine');

      localStorage.setItem('pb:tab', 'all');
      expect(readTab()).toBe('all');
    } finally {
      globalThis.localStorage = originalLocalStorage;
    }
  });
});

describe('RsvpButtons（回答選択ボタン）', () => {
  it('満員の予約情報で未回答の場合、「行く」ボタンは disabled ではなく押下時に onBlocked("full") が呼ばれる', () => {
    const handleAnswer = vi.fn();
    const handleBlocked = vi.fn();

    const vnode = RsvpButtons({
      value: null,
      status: '満員',
      onAnswer: handleAnswer,
      onBlocked: handleBlocked,
    });

    const buttons = vnode.props.children as Array<{
      props: {
        class: string;
        disabled?: boolean;
        onClick: () => void;
      };
    }>;
    expect(buttons).toHaveLength(3);

    const [yesBtn, maybeBtn, noBtn] = buttons;

    // 「行く」ボタン: disabled は false で、is-blocked-full クラスが付与される
    expect(yesBtn.props.disabled).toBeFalsy();
    expect(yesBtn.props.class).toContain('is-blocked-full');

    // 「行く」をクリックしたとき、onBlocked('full') が呼ばれ、onAnswer は呼ばれない
    yesBtn.props.onClick();
    expect(handleBlocked).toHaveBeenCalledWith('full');
    expect(handleAnswer).not.toHaveBeenCalled();

    // 「保留」や「行かない」は通常どおり onAnswer が呼ばれる
    maybeBtn.props.onClick();
    expect(handleAnswer).toHaveBeenCalledWith('保留');

    noBtn.props.onClick();
    expect(handleAnswer).toHaveBeenCalledWith('行かない');
  });

  it('自分がすでに「行く」を選択済みの場合は満員でもブロックされない', () => {
    const handleAnswer = vi.fn();
    const handleBlocked = vi.fn();

    const vnode = RsvpButtons({
      value: '行く',
      status: '満員',
      onAnswer: handleAnswer,
      onBlocked: handleBlocked,
    });

    const buttons = vnode.props.children as Array<{
      props: {
        class: string;
        disabled?: boolean;
        onClick: () => void;
      };
    }>;
    const [yesBtn] = buttons;
    expect(yesBtn.props.class).not.toContain('is-blocked-full');
  });

  it('中止または終了の予約情報では全ボタンが disabled になる', () => {
    const vnode = RsvpButtons({
      value: null,
      status: '中止',
      onAnswer: vi.fn(),
    });

    const buttons = vnode.props.children as Array<{
      props: {
        disabled?: boolean;
      };
    }>;
    for (const btn of buttons) {
      expect(btn.props.disabled).toBe(true);
    }
  });
});

describe('NavigationGuard（ui.tsx の画面遷移ガード）', () => {
  it('ガードが false を返した場合、go() による遷移が阻止される', () => {
    const originalLocation = globalThis.location;
    globalThis.location = { hash: '#/answer' } as Location;
    try {
      const guard = vi.fn().mockReturnValue(false);
      setNavigationGuard(guard);

      go('/settings');

      expect(guard).toHaveBeenCalledWith('/settings');
      expect(location.hash).toBe('#/answer');
    } finally {
      setNavigationGuard(null);
      globalThis.location = originalLocation;
    }
  });

  it('ガードが true を返した場合、go() による遷移が実行される', () => {
    const originalLocation = globalThis.location;
    globalThis.location = { hash: '#/answer' } as Location;
    try {
      const guard = vi.fn().mockReturnValue(true);
      setNavigationGuard(guard);

      go('/settings');

      expect(guard).toHaveBeenCalledWith('/settings');
      expect(location.hash).toBe('/settings');
    } finally {
      setNavigationGuard(null);
      globalThis.location = originalLocation;
    }
  });

  it('RSVP 画面の createRsvpNavigationGuard と go() の結合: 未保存の下書きがあるときの離脱確認・阻止・破棄移動', () => {
    const originalLocation = globalThis.location;
    globalThis.location = { hash: '#/answer' } as Location;
    clearGlobalDrafts();
    globalDrafts.unanswered.set('p1', '行く');
    const hasAnyChangesRef = { current: true };
    const confirmMock = vi.fn();

    try {
      setNavigationGuard(createRsvpNavigationGuard(hasAnyChangesRef, confirmMock));

      // 1. 同一画面（/answer）への移動は確認を出さずに許可され、下書きも消えない
      go('/answer');
      expect(confirmMock).not.toHaveBeenCalled();
      expect(globalDrafts.unanswered.get('p1')).toBe('行く');

      // 2. 別画面（/settings）への移動でキャンセルしたとき、遷移は阻止され下書きが保持される
      confirmMock.mockReturnValueOnce(false);
      go('/settings');
      expect(confirmMock).toHaveBeenCalledWith('回答の変更が反映されていません。破棄して移動しますか？');
      expect(location.hash).toBe('/answer');
      expect(hasAnyChangesRef.current).toBe(true);
      expect(globalDrafts.unanswered.get('p1')).toBe('行く');

      // 3. 別画面（/settings）への移動でOKしたとき、下書きが破棄されて遷移が実行される
      confirmMock.mockReturnValueOnce(true);
      go('/settings');
      expect(location.hash).toBe('/settings');
      expect(hasAnyChangesRef.current).toBe(false);
      expect(globalDrafts.unanswered.size).toBe(0);
    } finally {
      setNavigationGuard(null);
      clearGlobalDrafts();
      globalThis.location = originalLocation;
    }
  });

  it('hashchange（戻る操作）でガードがキャンセルされたとき、history.replaceState で履歴を増やさずにハッシュを戻し、次の遷移も詰まらない', () => {
    const originalLocation = globalThis.location;
    const originalHistory = globalThis.history;
    const replaceStateMock = vi.fn((_state: unknown, _title: string, url?: string | URL | null) => {
      if (typeof url === 'string') {
        globalThis.location.hash = url;
      }
    });
    globalThis.location = { hash: '#/', href: 'http://localhost/#/' } as Location;
    globalThis.history = { replaceState: replaceStateMock, length: 2 } as unknown as History;
    clearGlobalDrafts();
    globalDrafts.unanswered.set('p1', '行く');
    const hasAnyChangesRef = { current: true };
    const confirmMock = vi.fn();

    try {
      setNavigationGuard(createRsvpNavigationGuard(hasAnyChangesRef, confirmMock));

      // 1. 戻る操作で #/answer から #/ に変わったタイミングでキャンセルを選択
      confirmMock.mockReturnValueOnce(false);
      const res1 = handleHashChangeGuard('http://localhost/#/answer');
      expect(res1.allowed).toBe(false);
      expect(replaceStateMock).toHaveBeenCalledWith(null, '', '#/answer');
      expect(location.hash).toBe('#/answer');
      expect(globalDrafts.unanswered.get('p1')).toBe('行く');

      // 2. 再度戻る操作をして今度はOKを選択したとき、フラグ詰まりを起こさず正常に遷移できる
      globalThis.location.hash = '#/';
      confirmMock.mockReturnValueOnce(true);
      const res2 = handleHashChangeGuard('http://localhost/#/answer');
      expect(res2.allowed).toBe(true);
      expect(res2.parsed.path).toEqual([]);
      expect(hasAnyChangesRef.current).toBe(false);
      expect(globalDrafts.unanswered.size).toBe(0);
    } finally {
      setNavigationGuard(null);
      clearGlobalDrafts();
      globalThis.location = originalLocation;
      globalThis.history = originalHistory;
    }
  });
});

describe('募集カード（?r= 指定）から開いたときの即時保存と保存中 loadHome 重なり保護の結合検証', () => {
  it('?r=p1 で開いて RsvpButtons の ○ を押すと、完了ボタンを押さずに即時保存され、保存中に loadHome が重なっても巻き戻らない', async () => {
    const originalLocation = globalThis.location;
    try {
      // 1. 募集カードのリンク（?r=p1）から起動したときのハッシュ解決と id 抽出
      const resolvedHash = resolveInitialHash(new URLSearchParams('r=p1'));
      expect(resolvedHash).toBe('/answer?r=p1');
      globalThis.location = { hash: `#${resolvedHash}` } as Location;
      const parsed = parseHash();
      expect(parsed.path).toEqual(['answer']);
      const ids = parsed.query.getAll('r');
      expect(ids).toEqual(['p1']);
      const isSpecific = ids.length > 0;
      expect(isSpecific).toBe(true);

      // 2. 初期データと main.tsx 同等の syncTracker・一覧ステートを用意
      let now = 1000;
      const syncTracker = createPracticeSyncTracker(() => now);
      const practice1 = {
        id: 'p1',
        date: '2026-11-20',
        start: '18:00',
        end: '21:00',
        studio: 'サウンドスタジオノア 渋谷1号店',
        room: 'Ast',
        fee: 5000,
        status: '募集中' as const,
        booker: 'u1',
        groups: ['g1'],
      };
      let practicesList: PracticeView[] = [
        { practice: practice1, myAnswer: null, attendees: [] } as unknown as PracticeView,
      ];
      let specificChanges: SpecificChangeMap = new Map();
      const toastMock = vi.fn();

      // API保存を非同期で制御できるようにする（保存中に loadHome が重なるケースを再現）
      let resolveSave!: (v: PracticeView) => void;
      const apiSaveMock = vi.fn().mockImplementation(
        () =>
          new Promise<PracticeView>((resolve) => {
            resolveSave = resolve;
          }),
      );

      // 3. RsvpButtons を描画し、ユーザーが「○（行く）」ボタンを押す
      let savePromise!: Promise<'saved' | 'staged' | 'guarded' | 'not_found'>;
      const vnode = RsvpButtons({
        value: practicesList[0].myAnswer,
        status: practicesList[0].practice.status,
        onAnswer: (answer) => {
          savePromise = executeStageAnswer({
            id: 'p1',
            answer,
            isSpecific,
            fresh: true,
            busy: false,
            saving: false,
            originalPractice: practicesList[0],
            apiSave: apiSaveMock,
            touchPractice: (id) => {
              syncTracker.touchPractice(id);
              // 楽観的または保存中の一覧保護対象としてマーク
              practicesList = practicesList.map((v) =>
                v.practice.id === id ? { ...v, myAnswer: answer } : v,
              );
            },
            untouchPractice: (id) => syncTracker.untouchPractice(id),
            updatePractice: (updated) => {
              syncTracker.markUpdated(updated.practice.id);
              practicesList = practicesList.map((v) =>
                v.practice.id === updated.practice.id ? updated : v,
              );
            },
            toast: toastMock,
            onSpecificSaved: (updated, originalAnswer) => {
              specificChanges = recordSpecificChange(
                specificChanges,
                updated.practice,
                originalAnswer,
                answer,
              );
            },
            onDraftStaged: vi.fn(),
          });
        },
      });

      const buttons = vnode.props.children as Array<{ props: { onClick: () => void } }>;
      buttons[0].props.onClick(); // 「○（行く）」をタップ

      // 4. タップ直後: 完了ボタンを押さずとも即座に apiSave('p1', '行く') が呼ばれ、touched は Infinity になる
      expect(apiSaveMock).toHaveBeenCalledWith('p1', '行く');
      expect(syncTracker.touched.get('p1')).toBe(Infinity);

      // 5. 保存完了前にバックグラウンドの loadHome（古い未回答データ）が完了しても、Infinity 保護により巻き戻らない
      const staleHomePractices: PracticeView[] = [
        { practice: practice1, myAnswer: null, attendees: [] } as unknown as PracticeView,
      ];
      const keepDuringSave = syncTracker.prepareMerge(1100);
      practicesList = mergePracticesWithKeep(staleHomePractices, practicesList, keepDuringSave);
      expect(practicesList[0].myAnswer).toBe('行く');
      expect(syncTracker.touched.get('p1')).toBe(Infinity);

      // 6. 保存完了（t = 1500）
      now = 1500;
      const savedView = { practice: practice1, myAnswer: '行く', attendees: ['山田'] } as unknown as PracticeView;
      resolveSave(savedView);
      expect(await savePromise).toBe('saved');
      expect(toastMock).toHaveBeenCalledWith('回答を記録しました');
      expect(practicesList[0].myAnswer).toBe('行く');
      expect(syncTracker.touched.get('p1')).toBe(1500);

      // 送信文も即時生成されている
      const report = generateSpecificReport(specificChanges.values());
      expect(report).toContain('回答しました');
      expect(report).toContain('11/20');
    } finally {
      globalThis.location = originalLocation;
    }
  });
});
