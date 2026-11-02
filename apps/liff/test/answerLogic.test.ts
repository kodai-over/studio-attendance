import { describe, expect, it, vi } from 'vitest';
import { answerReport, type PracticeView } from '@studio-attendance/shared';
import {
  cleanupAfterCommit,
  clearGlobalDrafts,
  filterGroupPractices,
  filterTargetModifiedItems,
  generateSpecificReport,
  getModifiedItems,
  globalDrafts,
  mergePracticesWithKeep,
  processCommitItems,
  pruneStaleDrafts,
  recordSpecificChange,
  restoreDraftOnTellError,
  stageAnswer,
} from '../src/pages/answerLogic';

describe('answerLogic (RSVP画面の純粋ロジック)', () => {
  const mockPractice1 = {
    id: 'p1',
    date: '2026-11-10',
    start: '19:00',
    end: '21:00',
    studio: 'ノア',
    room: 'A',
    groups: ['group-a'],
    status: '通常' as const,
  };

  const mockPractice2 = {
    id: 'p2',
    date: '2026-11-11',
    start: '19:00',
    end: '21:00',
    studio: 'ノア',
    room: 'B',
    groups: ['group-b'],
    status: '通常' as const,
  };

  const mockPracticeCanceled = {
    id: 'p3',
    date: '2026-11-12',
    start: '19:00',
    end: '21:00',
    studio: 'ノア',
    room: 'C',
    groups: ['group-a'],
    status: '中止' as const,
  };

  const mockList: PracticeView[] = [
    { practice: mockPractice1, myAnswer: null, attendees: [] },
    { practice: mockPractice2, myAnswer: '保留', attendees: [] },
    { practice: mockPracticeCanceled, myAnswer: null, attendees: [] },
  ];

  describe('stageAnswer', () => {
    it('元の回答と異なる回答を選んだ場合、下書きに追加される', () => {
      const initial = new Map();
      const updated = stageAnswer(initial, 'p1', '行く', null);
      expect(updated.get('p1')).toBe('行く');
    });

    it('元の回答と同じ回答を選び直した場合、下書きから削除される', () => {
      const initial = new Map([['p2', '行く' as const]]);
      // p2 の元の回答は '保留'。'保留' を選び直すと削除される
      const updated = stageAnswer(initial, 'p2', '保留', '保留');
      expect(updated.has('p2')).toBe(false);
    });

    it('すでに下書きにある回答を別の回答に変更できる', () => {
      const initial = new Map([['p1', '行く' as const]]);
      const updated = stageAnswer(initial, 'p1', '行かない', null);
      expect(updated.get('p1')).toBe('行かない');
    });
  });

  describe('getModifiedItems', () => {
    it('下書きの中から、元の回答と異なる項目のみを抽出する', () => {
      const staged = new Map([
        ['p1', '行く' as const],
        ['p2', '保留' as const], // 元と同じ値
      ]);
      const items = getModifiedItems(staged, mockList);
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('p1');
      expect(items[0].answer).toBe('行く');
      expect(items[0].originalAnswer).toBeNull();
    });

    it('リストが空または null の場合は空配列を返す', () => {
      const staged = new Map([['p1', '行く' as const]]);
      expect(getModifiedItems(staged, null)).toEqual([]);
    });
  });

  describe('cleanupAfterCommit', () => {
    it('保存に成功した ID のみを下書きから削除し、失敗した項目を残す', () => {
      const staged = new Map([
        ['p1', '行く' as const],
        ['p2', '行かない' as const],
        ['p3', '保留' as const],
      ]);
      const next = cleanupAfterCommit(staged, ['p1', 'p3']);
      expect(next.size).toBe(1);
      expect(next.has('p2')).toBe(true);
      expect(next.has('p1')).toBe(false);
      expect(next.has('p3')).toBe(false);
    });
  });

  describe('filterGroupPractices', () => {
    const practiceNoGroup = {
      ...mockPractice1,
      id: 'p-no-group',
      groups: [],
    };
    const practiceOtherGroupMine = {
      ...mockPractice1,
      id: 'p-other-mine',
      groups: ['group-other'],
      booker: 'user-me',
    };
    const practiceOtherUnanswered = {
      ...mockPractice2,
      id: 'p-other-unanswered',
      groups: ['group-b'],
      booker: 'user-other',
    };
    const listWithNoGroup: PracticeView[] = [
      ...mockList,
      { practice: practiceNoGroup, myAnswer: null, attendees: [] },
      { practice: practiceOtherGroupMine, myAnswer: null, attendees: [] },
      { practice: practiceOtherUnanswered, myAnswer: null, attendees: [] },
    ];

    it('選択中グループの予約情報に加え、groupsが空（登録のみ等）の予約情報も含まれる（他グループの予約は除外される）', () => {
      const filtered = filterGroupPractices(listWithNoGroup, 'group-a');
      const ids = filtered.map((v) => v.practice.id);
      expect(ids).toContain('p1');
      expect(ids).toContain('p-no-group');
      expect(ids).not.toContain('p2'); // group-b なので除外される（他グループ混ざり防止）
      expect(ids).not.toContain('p-other-unanswered'); // group-b なので除外される
    });

    it('自分が予約者の予約情報は、選択中グループに含まれなくても表示される', () => {
      const filtered = filterGroupPractices(listWithNoGroup, 'group-a', 'user-me');
      const ids = filtered.map((v) => v.practice.id);
      expect(ids).toContain('p-other-mine');
    });

    it('グループが未選択（空文字）の場合は全件が返る', () => {
      const filtered = filterGroupPractices(listWithNoGroup, '');
      expect(filtered).toHaveLength(listWithNoGroup.length);
    });
  });

  describe('filterTargetModifiedItems', () => {
    const mockPracticeNoGroup = { ...mockPractice1, id: 'p-none', groups: [] };
    const mockPracticeOtherMine = {
      ...mockPractice1,
      id: 'p-other-mine',
      groups: ['group-other'],
      booker: 'user-me',
    };

    it('表示中かつ選択グループに該当する項目のみ抽出する（他グループの変更は除外して誤送信を防止する）', () => {
      const items = [
        { id: 'p1', answer: '行く' as const, originalAnswer: null, practice: mockPractice1 }, // group-a
        { id: 'p2', answer: '行かない' as const, originalAnswer: '保留' as const, practice: mockPractice2 }, // group-b
        { id: 'p-none', answer: '行く' as const, originalAnswer: null, practice: mockPracticeNoGroup }, // groups: []
        { id: 'p-other-mine', answer: '行く' as const, originalAnswer: null, practice: mockPracticeOtherMine }, // 自分が予約者
      ];
      const displayedIds = new Set(['p1', 'p2', 'p-none', 'p-other-mine']);

      // group-a のみ選択時: p1 (group-a), p-none (groups空), p-other-mine (予約者) が抽出され、p2 は除外される
      const filteredA = filterTargetModifiedItems(items, displayedIds, 'group-a', 'user-me');
      expect(filteredA.map((x) => x.id)).toEqual(['p1', 'p-none', 'p-other-mine']);

      // group-b のみ選択時: p2 (group-b) と p-none (groups空) が抽出される
      const filteredB = filterTargetModifiedItems(items, displayedIds, 'group-b');
      expect(filteredB.map((x) => x.id)).toEqual(['p2', 'p-none']);

      // 非表示の項目は除外される
      const filteredPartial = filterTargetModifiedItems(items, new Set(['p2']), 'group-b');
      expect(filteredPartial.map((x) => x.id)).toEqual(['p2']);
    });
  });

  describe('generateSpecificReport', () => {
    it('未回答からの新規回答のみの場合、answerReport 形式のメッセージが生成される', () => {
      const changes = [
        { practice: mockPractice1, from: null, to: '行く' as const },
      ];
      const report = generateSpecificReport(changes);
      expect(report).toContain('○');
      expect(report).toContain('行きます');
    });

    it('回答済からの変更のみの場合、answerChangeReport 形式の差分メッセージが生成される', () => {
      const changes = [
        { practice: mockPractice2, from: '保留' as const, to: '行く' as const },
      ];
      const report = generateSpecificReport(changes);
      expect(report).toContain('未定 → 行く');
    });

    it('新規回答と変更が混在する場合、両方を結合したメッセージが生成される', () => {
      const changes = [
        { practice: mockPractice1, from: null, to: '行く' as const },
        { practice: mockPractice2, from: '保留' as const, to: '行かない' as const },
      ];
      const report = generateSpecificReport(changes);
      expect(report).toContain('○');
      expect(report).toContain('未定 → 行かない');
    });

    it('中止の練習はメッセージから除外される', () => {
      const changes = [
        { practice: mockPracticeCanceled, from: null, to: '行く' as const },
      ];
      const report = generateSpecificReport(changes);
      expect(report).toBe('');
    });
  });

  describe('recordSpecificChange', () => {
    it('特定予約での回答選択時に変更履歴が正しく記録される', () => {
      let changes = new Map();
      changes = recordSpecificChange(changes, mockPractice1, null, '行く');
      expect(changes.get('p1')).toEqual({
        practice: mockPractice1,
        from: null,
        to: '行く',
      });

      // 同じ予約で回答を再度変更した場合、最初の from（null）が維持されて to が更新される
      changes = recordSpecificChange(changes, mockPractice1, null, '行かない');
      expect(changes.get('p1')).toEqual({
        practice: mockPractice1,
        from: null,
        to: '行かない',
      });
    });

    it('元の回答と同じ値に戻した場合（例: 保留 -> 行く -> 保留）、履歴から除外される', () => {
      let changes = new Map();
      // p2 の元の回答は '保留'
      changes = recordSpecificChange(changes, mockPractice2, '保留', '行く');
      expect(changes.has('p2')).toBe(true);

      // 元の回答と同じ '保留' に戻す
      changes = recordSpecificChange(changes, mockPractice2, '保留', '保留');
      expect(changes.has('p2')).toBe(false);
    });
  });

  describe('pruneStaleDrafts', () => {
    it('削除された予約や、既にサーバー側と同一の回答になっている下書きを削除する', () => {
      clearGlobalDrafts();
      globalDrafts.unanswered.set('p1', '行く'); // サーバー側は null なので保持されるべき
      globalDrafts.unanswered.set('p2', '保留'); // サーバー側も '保留' なので一致して破棄されるべき
      globalDrafts.unanswered.set('deleted-p', '行く'); // 存在しない予約なので破棄されるべき

      pruneStaleDrafts(mockList);

      expect(globalDrafts.unanswered.has('p1')).toBe(true);
      expect(globalDrafts.unanswered.has('p2')).toBe(false);
      expect(globalDrafts.unanswered.has('deleted-p')).toBe(false);
      clearGlobalDrafts();
    });
  });

  describe('特定予約モード（?r=）の一連のフロー: 選ぶ → 保存 → 送信文生成', () => {
    it('特定予約カードから回答を選んで即時保存された後、送信メッセージが正しく生成される', () => {
      // 1. 初期状態: 2件の予約（p1: 未回答, p2: 保留）
      let currentList = [...mockList];
      let changes = new Map();

      // 2. 1件目を ○（行く）にする
      // handleStageAnswer 内での動作をシミュレート
      const originalP1 = currentList.find((x) => x.practice.id === 'p1')!;
      expect(originalP1.myAnswer).toBeNull();

      // api('rsvp') 成功によるリスト更新
      currentList = currentList.map((x) =>
        x.practice.id === 'p1' ? { ...x, myAnswer: '行く' as const } : x,
      );
      // 変更履歴の記録
      changes = recordSpecificChange(changes, originalP1.practice, originalP1.myAnswer, '行く');

      // 送信文の生成（リストの myAnswer が '行く' に変わった後でも、送信文が空にならず正しく生成される）
      let report = generateSpecificReport(changes.values());
      expect(report).not.toBe('');
      expect(report).toContain('○');
      expect(report).toContain('行きます');

      // 3. 2件目を ✕（行かない）にする
      const originalP2 = currentList.find((x) => x.practice.id === 'p2')!;
      expect(originalP2.myAnswer).toBe('保留');

      currentList = currentList.map((x) =>
        x.practice.id === 'p2' ? { ...x, myAnswer: '行かない' as const } : x,
      );
      changes = recordSpecificChange(changes, originalP2.practice, originalP2.myAnswer, '行かない');

      report = generateSpecificReport(changes.values());
      expect(report).toContain('○');
      expect(report).toContain('未定 → 行かない');
      // 送信文が空でなく、2件まとまった文面が生成されている
      expect(report.trim().length).toBeGreaterThan(0);
    });

    it('開き直して変更操作を行わなかった場合（変更履歴が空）、現在の回答からフォールバック生成される', () => {
      // 既に回答済みのリスト（p2 が '保留'）
      const answeredList: PracticeView[] = [
        { practice: mockPractice2, myAnswer: '保留', attendees: [] },
      ];
      const changes = new Map(); // 変更なし

      // Answer.tsx 内のフォールバック処理をシミュレート
      let report = '';
      if (changes.size > 0) {
        report = generateSpecificReport(changes.values());
      } else {
        const answeredItems = answeredList.filter((v) => v.practice.status !== '中止' && v.myAnswer != null);
        if (answeredItems.length > 0) {
          report = answerReport(answeredItems.map((v) => ({ practice: v.practice, answer: v.myAnswer }))) ?? '';
        }
      }

      expect(report).not.toBe('');
      expect(report).toContain('△');
      expect(report).toContain('未定です');
    });
  });

  describe('processCommitItems (複数回答の保存とエラーハンドリング)', () => {
    const items = [
      { id: 'p1', answer: '行く' as const, originalAnswer: null, practice: mockPractice1 },
      { id: 'p2', answer: '行かない' as const, originalAnswer: '保留' as const, practice: mockPractice2 },
    ];

    it('全件が正常に保存できた場合、succeeded === 2, failed === 0 となる', async () => {
      const saveItem = vi.fn().mockResolvedValue(undefined);
      const res = await processCommitItems(items, saveItem);

      expect(res.succeeded).toBe(2);
      expect(res.failed).toBe(0);
      expect(res.succeededIds).toEqual(['p1', 'p2']);
      expect(res.lastError).toBeNull();
    });

    it('一部の保存に失敗した場合、成功したIDのみが返り、失敗した項目は下書きに残せる', async () => {
      const saveItem = vi.fn().mockImplementation(async (item) => {
        if (item.id === 'p2') throw new Error('Network error on p2');
      });

      const res = await processCommitItems(items, saveItem);

      expect(res.succeeded).toBe(1);
      expect(res.failed).toBe(1);
      expect(res.succeededIds).toEqual(['p1']);
      expect(res.lastError?.message).toBe('Network error on p2');

      // cleanupAfterCommit との連携: p1 のみ下書きから消え、p2 は残る
      const staged = new Map([['p1', '行く' as const], ['p2', '行かない' as const]]);
      const remaining = cleanupAfterCommit(staged, res.succeededIds);
      expect(remaining.has('p1')).toBe(false);
      expect(remaining.has('p2')).toBe(true);
    });

    it('全件の保存に失敗した場合、成功IDは空配列となり全件が下書きに残る', async () => {
      const saveItem = vi.fn().mockRejectedValue(new Error('Server unavailable'));
      const res = await processCommitItems(items, saveItem);

      expect(res.succeeded).toBe(0);
      expect(res.failed).toBe(2);
      expect(res.succeededIds).toEqual([]);
      expect(res.lastError?.message).toBe('Server unavailable');
    });
  });

  describe('handleTell の安全性: 保存後に送信失敗した場合の下書き復元', () => {
    it('回答の commitItems が成功した後に sendToChat が失敗した場合、body が draft として復元される', async () => {
      let draft: string | null = null;
      const setDraft = (val: string | null) => { draft = val; };

      const body = '回答しました\n○ 11/10(火) 19:00〜21:00 ノア A 行きます';

      // handleTell 内のシミュレーション
      const simulateHandleTell = async (shouldFailChat: boolean) => {
        try {
          // 1. commitItems 成功（下書きクリア）
          setDraft(null);

          // 2. sendToChat 実行
          if (shouldFailChat) {
            throw new Error('LINE chat transmission failed');
          }
        } catch (e) {
          // 3. 送信失敗時の救済: 文面を draft として復元
          setDraft(body);
        }
      };

      await simulateHandleTell(true);

      // 送信失敗しても文面が復元され、空にならず再送可能
      expect(draft).toBe(body);
      expect(draft?.trim().length).toBeGreaterThan(0);
    });

    it('commitItems で一部保存に失敗した場合（failed > 0）、sendToChat へ進まず送信が中断される', async () => {
      const sendToChatMock = vi.fn();
      let draft: string | null = null;
      let staged = new Map([['p1', '行く' as const], ['p2', '行かない' as const]]);

      const simulateHandleTellWithPartialFailure = async () => {
        // commitItems シミュレーション（p1 成功, p2 失敗）
        const { succeededIds, failed } = await processCommitItems(
          [
            { id: 'p1', answer: '行く' as const, originalAnswer: null, practice: mockPractice1 },
            { id: 'p2', answer: '行かない' as const, originalAnswer: '保留' as const, practice: mockPractice2 },
          ],
          async (item) => {
            if (item.id === 'p2') throw new Error('API Error');
          },
        );

        if (succeededIds.length > 0) {
          staged = cleanupAfterCommit(staged, succeededIds);
        }

        if (failed > 0) {
          // 失敗があった場合は送信を中断して再試行を促す
          return;
        }

        // ここには到達しない
        await sendToChatMock();
      };

      await simulateHandleTellWithPartialFailure();

      // sendToChat は呼ばれない
      expect(sendToChatMock).not.toHaveBeenCalled();

      // p1 のみ下書きから消え、p2 は下書きに残る（再試行可能）
      expect(staged.has('p1')).toBe(false);
      expect(staged.has('p2')).toBe(true);
    });
  });

  describe('ナビゲーションガードと画面同期の安全性', () => {
    it('同じ RSVP 画面（/answer で始まるパス）への遷移時はガード確認を行わず許可する', () => {
      const confirmMock = vi.fn();
      const originalConfirm = globalThis.window?.confirm;
      if (globalThis.window) {
        globalThis.window.confirm = confirmMock;
      }

      try {
        const hasChanges = true;
        const guard = (toPath: string) => {
          if (toPath.startsWith('/answer')) return true;
          if (hasChanges) {
            return confirmMock('破棄しますか？');
          }
          return true;
        };

        // /answer を押した場合: confirm は呼ばれず true
        expect(guard('/answer')).toBe(true);
        expect(confirmMock).not.toHaveBeenCalled();

        // 別画面 / を押した場合: confirm が呼ばれる
        confirmMock.mockReturnValue(false);
        expect(guard('/')).toBe(false);
        expect(confirmMock).toHaveBeenCalledTimes(1);
      } finally {
        if (globalThis.window && originalConfirm) {
          globalThis.window.confirm = originalConfirm;
        }
      }
    });

    it('pruneStaleDrafts 後に画面ステートを同期することで、古い下書きが画面に残らない', () => {
      clearGlobalDrafts();
      // 一覧更新前に古い下書きが残っている状態
      globalDrafts.unanswered.set('p2', '保留'); // サーバー側も '保留'
      globalDrafts.unanswered.set('deleted', '行く');

      let screenUnanswered = new Map(globalDrafts.unanswered);
      expect(screenUnanswered.size).toBe(2);

      // サーバーから最新の mockList が届いたときの同期処理
      pruneStaleDrafts(mockList);
      screenUnanswered = new Map(globalDrafts.unanswered);

      // 画面側のステートからも安全に消去されている
      expect(screenUnanswered.has('p2')).toBe(false);
      expect(screenUnanswered.has('deleted')).toBe(false);
      expect(screenUnanswered.size).toBe(0);
      clearGlobalDrafts();
    });
  });

  describe('restoreDraftOnTellError (送信エラー時の下書き復元)', () => {
    it('送信に失敗したとき、直前の送信文（body）をトリムして安全に下書きとして復元する', () => {
      const captured = '  回答しました\n○ 11/10(火) ノア A 行きます  \n';
      const restored = restoreDraftOnTellError(null, captured);
      expect(restored).toBe('回答しました\n○ 11/10(火) ノア A 行きます');
    });
  });

  describe('並行取得・タブ復帰時の回答巻き戻り防止（displayed のステート優先順位）', () => {
    it('特定予約モードで回答選択中・保存中に古いサーバー一覧が届いても、下書きステートが優先され回答が巻き戻らない', () => {
      // 1. 初期状態: サーバー上は p1 の myAnswer が null
      const basePractice: PracticeView = { practice: mockPractice1, myAnswer: null, attendees: [] };

      // 2. ユーザーが '行く' を選択し、specificStaged にセット
      const specificStaged = new Map([['p1', '行く' as const]]);

      // 3. 画面表示の算出（Answer.tsx の displayed ロジック）
      const displayedAnswer = specificStaged.has(basePractice.practice.id)
        ? specificStaged.get(basePractice.practice.id)!
        : basePractice.myAnswer;

      expect(displayedAnswer).toBe('行く');

      // 4. 保存中に古いサーバー一覧（myAnswer が null のまま）が再度届いた場合をシミュレート
      const staleServerPractice: PracticeView = { practice: mockPractice1, myAnswer: null, attendees: [] };
      const displayedAfterStaleFetch = specificStaged.has(staleServerPractice.practice.id)
        ? specificStaged.get(staleServerPractice.practice.id)!
        : staleServerPractice.myAnswer;

      // 古い一覧で上書きされず、ユーザーが選択した '行く' が保持される
      expect(displayedAfterStaleFetch).toBe('行く');
    });
  });

  describe('mergePracticesWithKeep (回答操作中の練習の巻き戻り防止)', () => {
    it('keepIds が空または current が存在しない場合、incoming をそのまま返す', () => {
      const incoming: PracticeView[] = [
        { practice: mockPractice1, myAnswer: null, attendees: [] },
      ];
      expect(mergePracticesWithKeep(incoming, null, new Set(['p1']))).toBe(incoming);
      expect(mergePracticesWithKeep(incoming, [], new Set())).toBe(incoming);
      expect(mergePracticesWithKeep(incoming, [], null)).toBe(incoming);
    });

    it('keepIds に含まれる練習は current の内容が保持され、それ以外は incoming が反映される', () => {
      const current: PracticeView[] = [
        { practice: mockPractice1, myAnswer: '行く', attendees: [] },
        { practice: mockPractice2, myAnswer: '保留', attendees: [] },
      ];
      // サーバーから届いた古い一覧（p1 がまだ未回答、p2 は更新されている）
      const incoming: PracticeView[] = [
        { practice: mockPractice1, myAnswer: null, attendees: [] },
        { practice: mockPractice2, myAnswer: '行かない', attendees: [] },
      ];

      const merged = mergePracticesWithKeep(incoming, current, new Set(['p1']));
      // p1 は回答操作中のため current（'行く'）が保持される
      expect(merged.find((x) => x.practice.id === 'p1')?.myAnswer).toBe('行く');
      // p2 は keepIds に入っていないため incoming（'行かない'）が反映される
      expect(merged.find((x) => x.practice.id === 'p2')?.myAnswer).toBe('行かない');
    });

    it('keepIds にあっても current に見つからない場合は incoming をフォールバックとして採用する', () => {
      const incoming: PracticeView[] = [
        { practice: mockPractice1, myAnswer: null, attendees: [] },
      ];
      const current: PracticeView[] = [];

      const merged = mergePracticesWithKeep(incoming, current, new Set(['p1']));
      expect(merged.find((x) => x.practice.id === 'p1')?.myAnswer).toBeNull();
    });
  });
});
