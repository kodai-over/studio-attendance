import { describe, expect, it, vi } from 'vitest';
import type { PracticeView } from '@studio-attendance/shared';
import {
  cleanupAfterCommit,
  clearGlobalDrafts,
  createPracticeSyncTracker,
  createRsvpNavigationGuard,
  executeStageAnswer,
  generateSpecificReport,
  getModifiedItems,
  globalDrafts,
  mergePracticesWithKeep,
  processCommitItems,
  recordSpecificChange,
  resolveAnswerTargets,
  stageAnswer,
  type SpecificChangeMap,
} from '../src/pages/answerLogic';
import { MyAnswerBadge, readTab } from '../src/pages/List';
import { filterByDayKind, groupByMonthWeek, resolveNextSelectedDate, toggleCollapseKey } from '../src/pages/calendarLogic';
import { canRemindGroup, confirmAndRemind } from '../src/pages/recruitLogic';
import { resolveInitialHash } from '../src/route';
import { RsvpButtons, cancelDeadlineDisplay, go, handleHashChangeGuard, hasLargeTitle, parseHash, setNavigationGuard } from '../src/ui';

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

  it('画面表示が「△ 未定」でも、RsvpButtons から新しい RSVP 画面（下書き→反映・タブ切替・途中失敗再試行）を通ってシート（API）に送られる値は従来どおり「保留」になる', async () => {
    clearGlobalDrafts();
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
    const practice2 = {
      id: 'p2',
      date: '2026-11-21',
      start: '19:00',
      end: '22:00',
      studio: 'サウンドスタジオノア 渋谷1号店',
      room: 'Bst',
      fee: 5000,
      status: '募集中' as const,
      booker: 'u1',
      groups: ['g1'],
    };
    const list: PracticeView[] = [
      { practice: practice1, myAnswer: null, attendees: [] } as unknown as PracticeView,
      { practice: practice2, myAnswer: '行く', attendees: ['山田'] } as unknown as PracticeView,
    ];

    try {
      // 1. 「未回答」タブで p1 の RsvpButtons「△ 未定」を押す -> 下書きに '保留' が入る
      let subTab: 'unanswered' | 'answered' = 'unanswered';
      const vnodeUnanswered = RsvpButtons({
        value: list[0].myAnswer,
        status: list[0].practice.status,
        onAnswer: (answer) => {
          void executeStageAnswer({
            id: 'p1',
            answer,
            isSpecific: false,
            fresh: true,
            busy: false,
            saving: false,
            originalPractice: list[0],
            apiSave: vi.fn(),
            touchPractice: vi.fn(),
            updatePractice: vi.fn(),
            toast: vi.fn(),
            onSpecificSaved: vi.fn(),
            onDraftStaged: (orig) => {
              globalDrafts[subTab] = stageAnswer(globalDrafts[subTab], 'p1', answer, orig);
            },
          });
        },
      });
      const unansweredBtns = vnodeUnanswered.props.children as Array<{ props: { onClick: () => void } }>;
      unansweredBtns[1].props.onClick(); // 中央の「△ 未定」ボタン
      expect(globalDrafts.unanswered.get('p1')).toBe('保留');

      // 2. 「回答済」タブへ切り替えて p2 の「△ 未定」を押す -> タブを切り替えても未回答タブの下書きは消えず、回答済タブにも '保留' が入る
      subTab = 'answered';
      const vnodeAnswered = RsvpButtons({
        value: list[1].myAnswer,
        status: list[1].practice.status,
        onAnswer: (answer) => {
          void executeStageAnswer({
            id: 'p2',
            answer,
            isSpecific: false,
            fresh: true,
            busy: false,
            saving: false,
            originalPractice: list[1],
            apiSave: vi.fn(),
            touchPractice: vi.fn(),
            updatePractice: vi.fn(),
            toast: vi.fn(),
            onSpecificSaved: vi.fn(),
            onDraftStaged: (orig) => {
              globalDrafts[subTab] = stageAnswer(globalDrafts[subTab], 'p2', answer, orig);
            },
          });
        },
      });
      const answeredBtns = vnodeAnswered.props.children as Array<{ props: { onClick: () => void } }>;
      answeredBtns[1].props.onClick(); // 中央の「△ 未定」ボタン
      expect(globalDrafts.unanswered.get('p1')).toBe('保留'); // タブ切り替え後も保持
      expect(globalDrafts.answered.get('p2')).toBe('保留');

      // 3. まとめて反映（1回目は p2 が失敗、2回目で再試行成功）-> シート（API）へ送られる answer は両方とも '保留'
      const allModified = [
        ...getModifiedItems(globalDrafts.unanswered, list),
        ...getModifiedItems(globalDrafts.answered, list),
      ];
      expect(allModified.map((m) => ({ id: m.id, answer: m.answer }))).toEqual([
        { id: 'p1', answer: '保留' },
        { id: 'p2', answer: '保留' },
      ]);

      const sentPayloads: Array<{ id: string; answer: string }> = [];
      let failP2Once = true;
      const firstCommit = await processCommitItems(allModified, async (item) => {
        if (item.id === 'p2' && failP2Once) {
          failP2Once = false;
          throw new Error('一時的な通信エラー');
        }
        sentPayloads.push({ id: item.id, answer: item.answer });
      });
      expect(firstCommit.succeeded).toBe(1);
      expect(firstCommit.failed).toBe(1);
      globalDrafts.unanswered = cleanupAfterCommit(globalDrafts.unanswered, firstCommit.succeededIds);
      globalDrafts.answered = cleanupAfterCommit(globalDrafts.answered, firstCommit.succeededIds);
      expect(globalDrafts.unanswered.size).toBe(0);
      expect(globalDrafts.answered.get('p2')).toBe('保留'); // 失敗した p2 は下書きに残る

      // 再試行で残りの p2 も反映成功
      const remaining = getModifiedItems(globalDrafts.answered, list);
      const secondCommit = await processCommitItems(remaining, async (item) => {
        sentPayloads.push({ id: item.id, answer: item.answer });
      });
      expect(secondCommit.succeeded).toBe(1);
      expect(secondCommit.failed).toBe(0);
      expect(sentPayloads).toEqual([
        { id: 'p1', answer: '保留' },
        { id: 'p2', answer: '保留' },
      ]);
    } finally {
      clearGlobalDrafts();
    }
  });
});

describe('cancelDeadlineDisplay（チケットのキャンセル期限の出し方）', () => {
  it('期限前は日時を出し、色は付けない', () => {
    expect(cancelDeadlineDisplay({ formatted: '11/9(月) 10:00', isSoon: false, isPast: false })).toEqual({ text: 'キャンセル期限 11/9(月) 10:00', tone: 'normal' });
  });

  it('期限が近いときは日時を出し、目立たせる', () => {
    expect(cancelDeadlineDisplay({ formatted: '11/6(金) 10:00', isSoon: true, isPast: false })).toEqual({ text: 'キャンセル期限 11/6(金) 10:00', tone: 'soon' });
  });

  it('期限を過ぎたら「キャンセル期限超過」と出す（予約者の「募集」でも消えない）', () => {
    expect(cancelDeadlineDisplay({ formatted: '11/4(水) 10:00', isSoon: true, isPast: true })).toEqual({ text: 'キャンセル期限超過', tone: 'past' });
  });

  it('スタジオにキャンセルのルールがなければ出さない', () => {
    expect(cancelDeadlineDisplay(null)).toBeNull();
  });
});

describe('hasLargeTitle（画面上部の大きい見出し）', () => {
  it('メニューから開く画面（見出しあり・戻るなし）だけ大きい見出しを出す', () => {
    expect(hasLargeTitle('ホーム', false)).toBe(true);
    expect(hasLargeTitle('ホーム')).toBe(true);
    expect(hasLargeTitle('回答', false)).toBe(true);
  });

  it('戻るがある画面や、見出しのない画面では出さない', () => {
    expect(hasLargeTitle('管理画面', true)).toBe(false);
    expect(hasLargeTitle(undefined, true)).toBe(false);
    expect(hasLargeTitle(undefined, false)).toBe(false);
  });
});

describe('RsvpButtons の取り消し（同じ記号をもう一度押す）', () => {
  const buttons = (props: Partial<Parameters<typeof RsvpButtons>[0]>) => {
    const vnode = RsvpButtons({ value: '行く', status: '募集中', onAnswer: () => {}, ...props });
    return vnode.props.children as { props: { class: string; onClick: () => void } }[];
  };

  it('選んでいる記号を押すと onClear が呼ばれ、onAnswer は呼ばれない', () => {
    const onAnswer = vi.fn();
    const onClear = vi.fn();
    buttons({ onAnswer, onClear })[0].props.onClick();
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('別の記号を押すと onAnswer が呼ばれる', () => {
    const onAnswer = vi.fn();
    const onClear = vi.fn();
    buttons({ onAnswer, onClear })[1].props.onClick();
    expect(onAnswer).toHaveBeenCalledWith('保留');
    expect(onClear).not.toHaveBeenCalled();
  });

  it('onClear がない画面（参加リンク）では、同じ記号を押しても何も起きない', () => {
    const onAnswer = vi.fn();
    expect(() => buttons({ onAnswer })[0].props.onClick()).not.toThrow();
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe('開始後の予約情報に対する詳細画面からの回答変更経路', () => {
  it('開始時刻を過ぎた予約情報でも、ID指定（?r= 指定）で回答画面を開いた場合は除外されず回答変更できる', () => {
    const today = '2026-11-02';
    const currentTime = '19:30';
    const userId = 'U_USER';
    const userGroups = ['G1'];
    const startedPractice = {
      practice: {
        id: 'p-started-detail',
        date: today,
        start: '18:00',
        end: '20:00',
        studio: 'worcle',
        room: '101',
        fee: 4000,
        status: '募集中' as const,
        booker: 'U_OTHER',
        groups: ['G1'],
      },
      myAnswer: '行く' as const,
    } as unknown as PracticeView;

    // 1. 通常の一覧（ID指定なし）では isRsvpTarget により開始後は除外される
    const targetsInList = resolveAnswerTargets([startedPractice], [], userId, userGroups, today, currentTime);
    expect(targetsInList).toHaveLength(0);

    // 2. 詳細画面の「回答を変更」から ID 指定（ids: ['p-started-detail']）で開いた場合は
    // resolveAnswerTargets の isSpecific 経路により確実に抽出され、回答変更の対象となる
    const targetsSpecific = resolveAnswerTargets([startedPractice], ['p-started-detail'], userId, userGroups, today, currentTime);
    expect(targetsSpecific).toHaveLength(1);
    expect(targetsSpecific[0].practice.id).toBe('p-started-detail');
  });
});

describe('RecruitDetail の「もう一度募集」', () => {
  const basePracticeView = {
    practice: {
      id: 'p-remind-1',
      date: '2026-11-20',
      start: '19:00',
      end: '21:00',
      studio: 'worcle',
      room: '101',
      fee: 4000,
      status: '募集中' as const,
      booker: 'U_BOOKER',
      groups: ['G1'],
    },
    canEdit: true,
  } as unknown as PracticeView;

  it('予約者・管理者以外（canEdit=false）には表示されない', () => {
    const generalView = { ...basePracticeView, canEdit: false } as PracticeView;
    const res = canRemindGroup(generalView);
    expect(res.canShow).toBe(false);
    expect(res.canSubmit).toBe(false);
  });

  it('予約者または管理者（canEdit=true）には表示され、募集中なら送信可能', () => {
    const res = canRemindGroup(basePracticeView);
    expect(res.canShow).toBe(true);
    expect(res.canSubmit).toBe(true);
  });

  it('満員の予約情報ではボタンが押せない（canSubmit=false）', () => {
    const fullView = {
      ...basePracticeView,
      practice: { ...basePracticeView.practice, status: '満員' as const },
    } as PracticeView;
    const res = canRemindGroup(fullView);
    expect(res.canShow).toBe(true);
    expect(res.canSubmit).toBe(false);
  });

  it('確認ダイアログでキャンセルした場合は送信関数を呼ばない', async () => {
    const onRemind = vi.fn().mockResolvedValue(true);
    const confirmFn = vi.fn().mockReturnValue(false);

    const sent = await confirmAndRemind({ id: 'G1', name: 'チームA' }, onRemind, confirmFn);
    expect(sent).toBe(false);
    expect(confirmFn).toHaveBeenCalledWith('チームA にもう一度募集カードを送りますか？');
    expect(onRemind).not.toHaveBeenCalled();
  });

  it('確認ダイアログでOKした場合は対象グループIDで送信関数を呼ぶ', async () => {
    const onRemind = vi.fn().mockResolvedValue(true);
    const confirmFn = vi.fn().mockReturnValue(true);

    const sent = await confirmAndRemind({ id: 'G1', name: 'チームA' }, onRemind, confirmFn);
    expect(sent).toBe(true);
    expect(confirmFn).toHaveBeenCalledWith('チームA にもう一度募集カードを送りますか？');
    expect(onRemind).toHaveBeenCalledWith('G1');
  });
});

describe('CalendarView の日付タップと解除', () => {
  it('未選択状態（null）で日付をタップするとその日付が選択される', () => {
    expect(resolveNextSelectedDate(null, '2026-11-10')).toBe('2026-11-10');
  });

  it('選択中の日付をもう一度タップすると解除（null）される', () => {
    expect(resolveNextSelectedDate('2026-11-10', '2026-11-10')).toBe(null);
  });

  it('別の日付をタップするとその日付に切り替わる', () => {
    expect(resolveNextSelectedDate('2026-11-10', '2026-11-15')).toBe('2026-11-15');
  });
});

describe('groupByMonthWeek の月跨ぎ週（11/30〜12/6）の仕様固定', () => {
  it('月をまたぐ週の予約情報は、それぞれの月の見出し配下に分割して所属する', () => {
    const pNov30 = {
      practice: { id: 'p-nov-30', date: '2026-11-30', start: '19:00', end: '21:00', studio: 'w', room: '1', fee: 0, status: '募集中' },
    } as unknown as PracticeView;
    const pDec01 = {
      practice: { id: 'p-dec-01', date: '2026-12-01', start: '19:00', end: '21:00', studio: 'w', room: '1', fee: 0, status: '募集中' },
    } as unknown as PracticeView;

    const groups = groupByMonthWeek([pNov30, pDec01]);
    expect(groups).toHaveLength(2);

    // 11月の見出し配下
    const novGroup = groups.find((g) => g.month === '2026-11');
    expect(novGroup).toBeDefined();
    expect(novGroup!.weeks).toHaveLength(1);
    expect(novGroup!.weeks[0].label).toBe('11/30〜12/6');
    expect(novGroup!.weeks[0].items.map((v) => v.practice.id)).toEqual(['p-nov-30']);

    // 12月の見出し配下
    const decGroup = groups.find((g) => g.month === '2026-12');
    expect(decGroup).toBeDefined();
    expect(decGroup!.weeks).toHaveLength(1);
    expect(decGroup!.weeks[0].label).toBe('11/30〜12/6');
    expect(decGroup!.weeks[0].items.map((v) => v.practice.id)).toEqual(['p-dec-01']);
  });

  it('月をまたぐ同一週の片方を畳んでも、もう一方の月の週は開いたまま独立して開閉できる', () => {
    let collapsed = new Set<string>();

    const novWeekKey = 'week:2026-11:2026-11-30';
    const decWeekKey = 'week:2026-12:2026-11-30';

    // 11月の週を折りたたむ
    collapsed = toggleCollapseKey(collapsed, novWeekKey);
    expect(collapsed.has(novWeekKey)).toBe(true);
    expect(collapsed.has(decWeekKey)).toBe(false);

    // 11月の週をもう一度押して展開
    collapsed = toggleCollapseKey(collapsed, novWeekKey);
    expect(collapsed.has(novWeekKey)).toBe(false);
    expect(collapsed.has(decWeekKey)).toBe(false);
  });
});

describe('List 画面の表示切り替え（日付選択・フィルター連動・0件表示）', () => {
  const pWeekday = {
    practice: { id: 'p-fri', date: '2026-11-06', start: '19:00', end: '21:00', studio: 'w', room: '1', fee: 0, status: '募集中' },
  } as unknown as PracticeView;
  const pSaturday = {
    practice: { id: 'p-sat', date: '2026-11-07', start: '19:00', end: '21:00', studio: 'w', room: '1', fee: 0, status: '募集中' },
  } as unknown as PracticeView;
  const list = [pWeekday, pSaturday];

  it('日付非選択時は曜日フィルターに応じた月・週アコーディオン（monthGroups）が生成される', () => {
    const filtered = filterByDayKind(list, 'weekday');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].practice.id).toBe('p-fri');

    const monthGroups = groupByMonthWeek(filtered);
    expect(monthGroups).toHaveLength(1);
    expect(monthGroups[0].weeks[0].items).toHaveLength(1);
  });

  it('日付選択中はその日だけのチケットが抽出され、月・週グループ（アコーディオン）は生成されない', () => {
    const selectedDate = '2026-11-06';
    const filteredList = filterByDayKind(list, 'all');

    // List.tsx のロジック: selectedDate があるときは filteredList から該当日のものだけを抽出
    const displayList = selectedDate
      ? filteredList.filter((v) => v.practice.date === selectedDate)
      : filteredList;
    const monthGroups = !selectedDate ? groupByMonthWeek(displayList) : [];

    expect(displayList).toHaveLength(1);
    expect(displayList[0].practice.id).toBe('p-fri');
    expect(monthGroups).toHaveLength(0); // 見出しは非表示
  });

  it('曜日フィルター適用中に合致しない日付を選択した場合は0件（空表示）となる', () => {
    // 平日のみ適用中に、土曜の日付（2026-11-07）を選択
    const filteredList = filterByDayKind(list, 'weekday');
    const selectedDate = '2026-11-07';

    const displayList = selectedDate
      ? filteredList.filter((v) => v.practice.date === selectedDate)
      : filteredList;

    expect(displayList).toHaveLength(0);
  });

  it('予約情報が1件もない場合は displayList が空となり空表示状態になる', () => {
    const emptyList: PracticeView[] = [];
    const filtered = filterByDayKind(emptyList, 'holiday');
    expect(filtered).toHaveLength(0);
    const monthGroups = groupByMonthWeek(filtered);
    expect(monthGroups).toHaveLength(0);
  });
});
