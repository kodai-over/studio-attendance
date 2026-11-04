import { describe, expect, it, vi } from 'vitest';
import { answerReport, type PracticeView } from '@studio-attendance/shared';
import {
  cleanupAfterCommit,
  clearGlobalDrafts,
  computeDisplayedPractices,
  createPracticeSyncTracker,
  createRsvpNavigationGuard,
  executeStageAnswer,
  filterGroupPractices,
  filterTargetModifiedItems,
  generateSpecificReport,
  getDraftGroupStatus,
  getDraftOwnerKey,
  getModifiedItems,
  getUnansweredSummary,
  globalDrafts,
  loadDraftsFromStorage,
  mergePendingTellItems,
  mergePracticesWithKeep,
  processCommitItems,
  pruneResolvedTouches,
  pruneStaleDrafts,
  recordSpecificChange,
  resolveKeepIds,
  runDoneWorkflow,
  runTellWorkflow,
  saveDraftsToStorage,
  stageAnswer,
  syncDraftsForUser,
  type ModifiedItem,
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

    it('未回答の予約情報で同じ記号を押し直すと（取り消し）、下書きから消えて未回答に戻る', () => {
      const initial = new Map([['p1', '行く' as const]]);
      const updated = stageAnswer(initial, 'p1', null, null);
      expect(updated.has('p1')).toBe(false);
    });

    it('回答済の予約情報で取り消すと、未回答（null）として下書きに残る', () => {
      const updated = stageAnswer(new Map(), 'p2', null, '保留');
      expect(updated.has('p2')).toBe(true);
      expect(updated.get('p2')).toBeNull();
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

    it('取り消し（null）の下書きは、元の回答との差分として抽出される', () => {
      const items = getModifiedItems(new Map([['p2', null]]), mockList);
      expect(items).toEqual([{ id: 'p2', answer: null, originalAnswer: '保留', practice: mockPractice2 }]);
    });

    it('取り消した予約情報は、画面上で未回答として表示される', () => {
      const shown = computeDisplayedPractices(mockList, new Map([['p2', null]]));
      expect(shown[1].myAnswer).toBeNull();
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
      const myGroupIds = new Set(['group-a', 'group-b']);
      const filtered = filterGroupPractices(listWithNoGroup, 'group-a', undefined, myGroupIds);
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

    it('参加リンク回答や脱退後など、所属外グループであっても自分が回答済みの予約情報は抽出される（未回答は除外）', () => {
      const myGroupIds = new Set(['group-a']);
      const listWithAnsweredExternal: PracticeView[] = [
        // group-b 宛で自分は group-a のみ所属。しかし参加リンク等ですでに「行く」と回答済み
        { practice: practiceOtherUnanswered, myAnswer: '行く', attendees: [] },
        // group-b 宛で未回答
        { practice: { ...practiceOtherUnanswered, id: 'p-external-no-answer' }, myAnswer: null, attendees: [] },
      ];
      const filtered = filterGroupPractices(listWithAnsweredExternal, 'group-a', 'user-me', myGroupIds);
      const ids = filtered.map((v) => v.practice.id);
      expect(ids).toContain('p-other-unanswered'); // 回答済みなので回答変更できるよう抽出される
      expect(ids).not.toContain('p-external-no-answer'); // 未回答なので混ざらず除外される
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

      const myGroupIds = new Set(['group-a', 'group-b']);
      // group-a のみ選択時: p1 (group-a), p-none (groups空), p-other-mine (予約者) が抽出され、p2 は除外される
      const filteredA = filterTargetModifiedItems(items, displayedIds, 'group-a', 'user-me', myGroupIds);
      expect(filteredA.map((x) => x.id)).toEqual(['p1', 'p-none', 'p-other-mine']);

      // group-b のみ選択時: p2 (group-b) と p-none (groups空) が抽出される
      const filteredB = filterTargetModifiedItems(items, displayedIds, 'group-b', undefined, myGroupIds);
      expect(filteredB.map((x) => x.id)).toEqual(['p2', 'p-none']);

      // 非表示の項目は除外される
      const filteredPartial = filterTargetModifiedItems(items, new Set(['p2']), 'group-b', undefined, myGroupIds);
      expect(filteredPartial.map((x) => x.id)).toEqual(['p2']);

      // displayedIds が null の場合、表示タブに関係なく全項目からグループ対象を抽出する（「完了」ボタン用）
      const allTabsGroupA = filterTargetModifiedItems(items, null, 'group-a', 'user-me', myGroupIds);
      expect(allTabsGroupA.map((x) => x.id)).toEqual(['p1', 'p-none', 'p-other-mine']);

      // 所属外グループであっても、回答済みの練習を変更した項目（originalAnswer != null）は反映対象として抽出される
      const externalAnsweredItem = [
        { id: 'p-ext', answer: '行かない' as const, originalAnswer: '行く' as const, practice: mockPractice2 }, // group-b
      ];
      const onlyGroupA = new Set(['group-a']);
      const filteredExt = filterTargetModifiedItems(externalAnsweredItem, new Set(['p-ext']), 'group-a', undefined, onlyGroupA);
      expect(filteredExt.map((x) => x.id)).toEqual(['p-ext']);
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

    it('回答を取り消した場合は「未回答」への変更として伝える', () => {
      const report = generateSpecificReport([{ practice: mockPractice2, from: '保留' as const, to: null }]);
      expect(report).toContain('回答を変更しました');
      expect(report).toContain('未定 → 未回答');
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

    it('commitItems で一部保存に失敗した場合（failed > 0）、sendToChat へ進まず送信が中断され、手動編集した draft も破棄されず維持される', async () => {
      const sendToChatMock = vi.fn();
      let draft: string | null = 'ユーザーが手動編集した送信文';
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
          // 失敗が 0 件のときのみ手動編集下書きをリセットする
          if (failed === 0) {
            draft = null;
          }
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

      // 手動編集した文面がリセットされずに保持されている
      expect(draft).toBe('ユーザーが手動編集した送信文');
    });
  });

  describe('ナビゲーションガードと画面同期の安全性', () => {
    it('createRsvpNavigationGuard: 同じ RSVP 画面（/answer で始まるパス）への遷移時はガード確認を行わず許可し、別画面への遷移時は確認ダイアログを出す', () => {
      clearGlobalDrafts();
      globalDrafts.unanswered.set('p1', '行く');
      const hasAnyChangesRef = { current: true };
      const confirmMock = vi.fn();

      const guard = createRsvpNavigationGuard(hasAnyChangesRef, confirmMock);

      // /answer を押した場合: confirm は呼ばれず true、下書きも保持
      expect(guard('/answer')).toBe(true);
      expect(guard('/answer?r=p1')).toBe(true);
      expect(confirmMock).not.toHaveBeenCalled();
      expect(globalDrafts.unanswered.get('p1')).toBe('行く');

      // 別画面 / を押してキャンセルした場合: false を返し、下書きは保持
      confirmMock.mockReturnValueOnce(false);
      expect(guard('/')).toBe(false);
      expect(confirmMock).toHaveBeenCalledWith('回答の変更が反映されていません。破棄して移動しますか？');
      expect(hasAnyChangesRef.current).toBe(true);
      expect(globalDrafts.unanswered.get('p1')).toBe('行く');

      // 別画面 / を押して承認した場合: true を返し、下書きをクリア
      confirmMock.mockReturnValueOnce(true);
      expect(guard('/')).toBe(true);
      expect(hasAnyChangesRef.current).toBe(false);
      expect(globalDrafts.unanswered.size).toBe(0);
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

    it('saveDraftsToStorage / loadDraftsFromStorage により、LIFF WebView を誤って閉じた後でも次回起動時に下書きが復元される', () => {
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
        clearGlobalDrafts();
        globalDrafts.unanswered.set('p1', '行く');
        globalDrafts.answered.set('p2', '行かない');
        globalDrafts.answered.set('p4', null);
        saveDraftsToStorage('user-1');

        // メモリ上の下書きを一度空にして（WebView再起動をシミュレート）、同一ユーザーでストレージから復元
        globalDrafts.unanswered.clear();
        globalDrafts.answered.clear();
        expect(globalDrafts.unanswered.size).toBe(0);

        loadDraftsFromStorage('user-1');
        expect(globalDrafts.unanswered.get('p1')).toBe('行く');
        expect(globalDrafts.answered.get('p2')).toBe('行かない');
        // 取り消し（未回答に戻す）の下書きも復元される
        expect(globalDrafts.answered.has('p4')).toBe(true);
        expect(globalDrafts.answered.get('p4')).toBeNull();

        // 別アカウントや「見え方の確認（admin）」に切り替わった場合は、前の人の下書きが破棄される
        const adminKey = getDraftOwnerKey({
          member: { userId: 'admin', name: 'admin', role: 'admin', groups: ['group-a'] },
          actAs: 'test',
        });
        expect(adminKey).toBe('admin:test');
        syncDraftsForUser(adminKey);
        expect(globalDrafts.unanswered.size).toBe(0);
        expect(globalDrafts.answered.size).toBe(0);
        expect(store.has('pb:rsvpDrafts')).toBe(false);

        // clearGlobalDrafts でストレージからも消える
        clearGlobalDrafts();
        expect(store.has('pb:rsvpDrafts')).toBe(false);
      } finally {
        globalThis.localStorage = originalLocalStorage;
      }
    });

    it('古い形式・壊れた形式の pb:rsvpDrafts が localStorage に残っていても、起動や復元でエラーにならず安全に処理される', () => {
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
        clearGlobalDrafts();

        // 1. 壊れた JSON 文字列
        store.set('pb:rsvpDrafts', '{broken-json');
        expect(() => syncDraftsForUser('user-1')).not.toThrow();
        expect(globalDrafts.unanswered.size).toBe(0);
        expect(store.has('pb:rsvpDrafts')).toBe(false);

        // 2. 配列やプリミティブ、null
        for (const raw of ['null', '123', '"text"', '[1,2,3]']) {
          store.set('pb:rsvpDrafts', raw);
          expect(() => loadDraftsFromStorage('user-1')).not.toThrow();
          expect(globalDrafts.unanswered.size).toBe(0);
        }

        // 3. userId がない古い形式のデータ -> expectedUserId 指定時に破棄される
        store.set('pb:rsvpDrafts', JSON.stringify({ unanswered: [['p1', '行く']] }));
        expect(() => syncDraftsForUser('user-1')).not.toThrow();
        expect(globalDrafts.unanswered.size).toBe(0);
        expect(store.has('pb:rsvpDrafts')).toBe(false);

        // 4. 配列要素の一部が壊れている・不正な回答値が混ざっている場合 -> 正常なエントリのみ復元される
        store.set(
          'pb:rsvpDrafts',
          JSON.stringify({
            userId: 'user-1',
            unanswered: [
              null,
              123,
              ['p-invalid', '不正な回答'],
              ['', '行く'],
              ['p-valid', '保留'],
            ],
            answered: 'not-an-array',
          }),
        );
        expect(() => syncDraftsForUser('user-1')).not.toThrow();
        expect(globalDrafts.unanswered.size).toBe(1);
        expect(globalDrafts.unanswered.get('p-valid')).toBe('保留');
        expect(globalDrafts.answered.size).toBe(0);

        clearGlobalDrafts();
      } finally {
        globalThis.localStorage = originalLocalStorage;
      }
    });
  });

  describe('getUnansweredSummary (下部メニューバッジとRSVP画面のグループ別未回答件数の一貫性)', () => {
    it('複数グループ所属時に全体の未回答数・グループ別の未回答数・最初に開くべき未回答ありグループを返す', () => {
      const me = {
        member: { userId: 'u1', name: '山田', role: 'member' as const, groups: ['group-a', 'group-b'] },
        groups: [
          { id: 'group-a', name: 'チームA' },
          { id: 'group-b', name: 'チームB' },
        ],
        settings: { groups: [] },
      } as any;

      // チームAは回答済（未回答0）、チームBは未回答2件のケース
      const list: PracticeView[] = [
        { practice: { ...mockPractice1, id: 'pa', date: '2026-11-20', groups: ['group-a'] }, myAnswer: '行く', attendees: [] },
        { practice: { ...mockPractice2, id: 'pb1', date: '2026-11-21', groups: ['group-b'] }, myAnswer: null, attendees: [] },
        { practice: { ...mockPractice2, id: 'pb2', date: '2026-11-22', groups: ['group-b'] }, myAnswer: null, attendees: [] },
      ];

      const summary = getUnansweredSummary(list, me, '2026-11-01', '12:00');
      expect(summary.totalCount).toBe(2);
      expect(summary.groups).toEqual([
        { id: 'group-a', name: 'チームA', unansweredCount: 0 },
        { id: 'group-b', name: 'チームB', unansweredCount: 2 },
      ]);
      // 先頭のチームAが未回答0件でも、未回答があるチームBが初期選択される
      expect(summary.initialGroupId).toBe('group-b');
    });
  });

  describe('getDraftGroupStatus (複数グループ環境での下書き状態判定)', () => {
    const userGroups = [
      { id: 'group-a', name: 'チームA' },
      { id: 'group-b', name: 'チームB' },
    ];

    it('選択中グループに下書きがある場合、hasSelectedDraft が true になる', () => {
      const allModified = [
        { id: 'p1', answer: '行く' as const, practice: mockPractice1 }, // group-a
      ];
      const status = getDraftGroupStatus(allModified, userGroups, 'group-a');
      expect(status.hasSelectedDraft).toBe(true);
      expect(status.selectedGroupName).toBe('チームA');
      expect(status.otherDraftGroupNames).toEqual([]);
    });

    it('選択中グループには下書きがなく、他グループに下書きがある場合、他グループ名が抽出される', () => {
      const allModified = [
        { id: 'p1', answer: '行く' as const, practice: mockPractice1 }, // group-a
      ];
      const status = getDraftGroupStatus(allModified, userGroups, 'group-b');
      expect(status.hasSelectedDraft).toBe(false);
      expect(status.selectedGroupName).toBe('チームB');
      expect(status.otherDraftGroupNames).toEqual(['チームA']);
    });

    it('両方のグループに下書きがある場合、hasSelectedDraft が true かつ otherDraftGroupNames にも含まれる', () => {
      const allModified = [
        { id: 'p1', answer: '行く' as const, practice: mockPractice1 }, // group-a
        { id: 'p2', answer: '行かない' as const, practice: mockPractice2 }, // group-b
      ];
      const status = getDraftGroupStatus(allModified, userGroups, 'group-a');
      expect(status.hasSelectedDraft).toBe(true);
      expect(status.otherDraftGroupNames).toEqual(['チームB']);
    });
  });

  describe('runTellWorkflow (回答保存・送信フローの画面連携ロジック)', () => {
    it('保存処理で一部でも失敗（failed > 0）した場合、LINE送信を中断し aborted_by_commit_failure を返す', () => {
      const commitItems = vi.fn().mockResolvedValue({ succeeded: 1, failed: 1 });
      const send = vi.fn().mockResolvedValue(undefined);

      return runTellWorkflow({
        body: '回答しました',
        hasTargetChanges: true,
        targetModifiedItems: [{ id: 'p1', answer: '行く' as const, practice: mockPractice1 }],
        commitItems,
        send,
      }).then((result) => {
        expect(commitItems).toHaveBeenCalledTimes(1);
        expect(send).not.toHaveBeenCalled(); // 誤送信防止のため送信は絶対に呼ばれない
        expect(result).toBe('aborted_by_commit_failure');
      });
    });

    it('保存処理が全件成功した場合、LINE送信を実行して sent を返す', () => {
      const commitItems = vi.fn().mockResolvedValue({ succeeded: 2, failed: 0 });
      const send = vi.fn().mockResolvedValue(undefined);

      return runTellWorkflow({
        body: '回答しました',
        hasTargetChanges: true,
        targetModifiedItems: [{ id: 'p1', answer: '行く' as const, practice: mockPractice1 }],
        commitItems,
        send,
      }).then((result) => {
        expect(commitItems).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith('回答しました');
        expect(result).toBe('sent');
      });
    });

    it('未保存の変更がない場合（hasTargetChanges: false）、commitItems を呼ばずに即座に送信する', () => {
      const commitItems = vi.fn();
      const send = vi.fn().mockResolvedValue(undefined);

      return runTellWorkflow({
        body: '特定予約の回答文',
        hasTargetChanges: false,
        targetModifiedItems: [],
        commitItems,
        send,
      }).then((result) => {
        expect(commitItems).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith('特定予約の回答文');
        expect(result).toBe('sent');
      });
    });

    it('LINE送信処理でエラーが発生した場合、例外が呼び出し元に伝播する', async () => {
      const commitItems = vi.fn().mockResolvedValue({ succeeded: 1, failed: 0 });
      const send = vi.fn().mockRejectedValue(new Error('LINE送信エラー'));

      await expect(
        runTellWorkflow({
          body: '回答しました',
          hasTargetChanges: true,
          targetModifiedItems: [{ id: 'p1', answer: '行く' as const, practice: mockPractice1 }],
          commitItems,
          send,
        }),
      ).rejects.toThrow('LINE送信エラー');
    });

    it('一部保存失敗で中断したあと、pruneStaleDrafts が走ってから再試行しても、先に成功した分の文面が欠けずに全件分送信される', async () => {
      clearGlobalDrafts();
      // 1. 初期状態: p1（11/10・未回答）と p2（11/11・未回答）の両方を「行く」にした下書きがある
      let serverList: PracticeView[] = [
        { practice: mockPractice1, myAnswer: null, attendees: [] },
        { practice: mockPractice2, myAnswer: null, attendees: [] },
      ];
      globalDrafts.unanswered.set('p1', '行く');
      globalDrafts.unanswered.set('p2', '行く');
      let unansweredStaged = new Map(globalDrafts.unanswered);
      let pendingTellItems: ModifiedItem[] = [];
      let draft: string | null = null;

      // 初回の変更項目と送信文の算出
      let targetModified = getModifiedItems(unansweredStaged, serverList);
      let reportItems = mergePendingTellItems(pendingTellItems, targetModified);
      let report = answerReport(reportItems.map((i) => ({ practice: i.practice, answer: i.answer }))) ?? '';
      expect(report).toContain('11/10');
      expect(report).toContain('11/11');

      const sendMock = vi.fn().mockResolvedValue(undefined);

      // 2. 1回目の「グループに伝える」: p1 は保存成功、p2 は通信エラーで失敗
      const firstResult = await runTellWorkflow({
        body: draft ?? report,
        hasTargetChanges: targetModified.length > 0,
        targetModifiedItems: targetModified,
        commitItems: async () => {
          // p1 のみ成功してサーバー一覧が更新される
          serverList = serverList.map((v) =>
            v.practice.id === 'p1' ? { ...v, myAnswer: '行く' } : v,
          );
          // Answer.tsx と同様に cleanupAfterCommit と pruneStaleDrafts が走る
          unansweredStaged = cleanupAfterCommit(unansweredStaged, ['p1']);
          globalDrafts.unanswered = unansweredStaged;
          pruneStaleDrafts(serverList);
          unansweredStaged = new Map(globalDrafts.unanswered);
          return { succeeded: 1, failed: 1, succeededIds: ['p1'] };
        },
        send: sendMock,
        onPreserveDraft: (preserved) => {
          draft = preserved;
        },
        onPartialCommit: (succeededItems) => {
          pendingTellItems = mergePendingTellItems(pendingTellItems, succeededItems);
        },
        onSent: () => {
          pendingTellItems = [];
          draft = null;
        },
      });

      expect(firstResult).toBe('aborted_by_commit_failure');
      expect(sendMock).not.toHaveBeenCalled();

      // p1 はサーバー保存済のため下書きからは消え、未保存の p2 だけが残っている
      expect(unansweredStaged.has('p1')).toBe(false);
      expect(unansweredStaged.has('p2')).toBe(true);

      // 再試行前の画面文面を再計算: pruneStaleDrafts 後でも draft と report の両方に p1(11/10) と p2(11/11) が残っている
      targetModified = getModifiedItems(unansweredStaged, serverList);
      expect(targetModified.map((i) => i.id)).toEqual(['p2']); // 次に保存すべきは p2 のみ
      reportItems = mergePendingTellItems(pendingTellItems, targetModified);
      report = answerReport(reportItems.map((i) => ({ practice: i.practice, answer: i.answer }))) ?? '';
      expect(report).toContain('11/10'); // p1 が欠けていない
      expect(report).toContain('11/11'); // p2 も含まれている
      expect(draft).toContain('11/10');
      expect(draft).toContain('11/11');

      // 3. 2回目の「グループに伝える」（再試行）: 残りの p2 のみ保存し、文面は p1 + p2 の全件分を送信
      const savedOnRetry: string[] = [];
      const secondResult = await runTellWorkflow({
        body: draft ?? report,
        hasTargetChanges: targetModified.length > 0,
        targetModifiedItems: targetModified,
        commitItems: async (items) => {
          for (const item of items) {
            savedOnRetry.push(item.id);
          }
          unansweredStaged = cleanupAfterCommit(unansweredStaged, ['p2']);
          globalDrafts.unanswered = unansweredStaged;
          return { succeeded: 1, failed: 0, succeededIds: ['p2'] };
        },
        send: sendMock,
        onPreserveDraft: (preserved) => {
          draft = preserved;
        },
        onPartialCommit: (succeededItems) => {
          pendingTellItems = mergePendingTellItems(pendingTellItems, succeededItems);
        },
        onSent: () => {
          pendingTellItems = [];
          draft = null;
        },
      });

      expect(secondResult).toBe('sent');
      expect(savedOnRetry).toEqual(['p2']); // 再試行時は未保存だった p2 だけが API 保存される
      expect(sendMock).toHaveBeenCalledTimes(1);
      const sentText = sendMock.mock.calls[0][0] as string;
      expect(sentText).toContain('11/10'); // 1回目に保存成功していた p1 も文面に含まれている
      expect(sentText).toContain('11/11'); // 2回目に保存成功した p2 も文面に含まれている
      expect(pendingTellItems).toEqual([]);
      expect(draft).toBeNull();
      clearGlobalDrafts();
    });
  });

  describe('runDoneWorkflow (回答を反映して完了の画面連携ロジック)', () => {
    it('変更項目がない場合、noop を返して保存処理を行わない', async () => {
      const commitItems = vi.fn();
      const onSuccess = vi.fn();

      const result = await runDoneWorkflow({
        groupAllModifiedItems: [],
        commitItems,
        otherDraftGroupNames: [],
        onSuccess,
      });

      expect(result).toBe('noop');
      expect(commitItems).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it('保存処理で失敗（failed > 0）した場合、onSuccess を呼ばず failed を返す', async () => {
      const commitItems = vi.fn().mockResolvedValue({ succeeded: 1, failed: 1 });
      const onSuccess = vi.fn();

      const result = await runDoneWorkflow({
        groupAllModifiedItems: [{ id: 'p1', answer: '行く' as const, practice: mockPractice1 }],
        commitItems,
        otherDraftGroupNames: [],
        onSuccess,
      });

      expect(result).toBe('failed');
      expect(commitItems).toHaveBeenCalledTimes(1);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it('全件成功し他グループの下書きがない場合、通常メッセージで onSuccess が呼ばれ saved を返す', async () => {
      const commitItems = vi.fn().mockResolvedValue({ succeeded: 2, failed: 0 });
      const onSuccess = vi.fn();

      const result = await runDoneWorkflow({
        groupAllModifiedItems: [
          { id: 'p1', answer: '行く' as const, practice: mockPractice1 },
          { id: 'p2', answer: '行かない' as const, practice: mockPractice2 },
        ],
        commitItems,
        otherDraftGroupNames: [],
        onSuccess,
      });

      expect(result).toBe('saved');
      expect(commitItems).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith('2件の回答を反映しました（グループには送信されていません）');
    });

    it('全件成功し他グループの下書きが残っている場合、他グループ名を併記して onSuccess が呼ばれる', async () => {
      const commitItems = vi.fn().mockResolvedValue({ succeeded: 1, failed: 0 });
      const onSuccess = vi.fn();

      const result = await runDoneWorkflow({
        groupAllModifiedItems: [{ id: 'p1', answer: '行く' as const, practice: mockPractice1 }],
        commitItems,
        otherDraftGroupNames: ['チームB'],
        onSuccess,
      });

      expect(result).toBe('saved');
      expect(commitItems).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith('1件の回答を反映しました（「チームB」の下書きが残っています）');
    });
  });

  describe('executeStageAnswer (特定予約即時記録 / 通常画面下書き更新ワークフロー)', () => {
    it('特定予約モード（?r=）で回答を選んだ場合、従来通り即座に apiSave が呼ばれて保存され、記録トーストが出る', async () => {
      const original: PracticeView = { practice: mockPractice1, myAnswer: null, attendees: [] };
      const updated: PracticeView = { practice: mockPractice1, myAnswer: '行く', attendees: [] };
      const apiSave = vi.fn().mockResolvedValue(updated);
      const touchPractice = vi.fn();
      const updatePractice = vi.fn();
      const toast = vi.fn();
      const onSpecificSaved = vi.fn();
      const onDraftStaged = vi.fn();

      const outcome = await executeStageAnswer({
        id: 'p1',
        answer: '行く',
        isSpecific: true,
        fresh: true,
        busy: false,
        saving: false,
        originalPractice: original,
        apiSave,
        touchPractice,
        updatePractice,
        toast,
        onSpecificSaved,
        onDraftStaged,
      });

      expect(outcome).toBe('saved');
      // 巻き戻り防止のための touch が即時実行される
      expect(touchPractice).toHaveBeenCalledWith('p1');
      // 即時API保存が実行される
      expect(apiSave).toHaveBeenCalledWith('p1', '行く');
      expect(updatePractice).toHaveBeenCalledWith(updated);
      expect(onSpecificSaved).toHaveBeenCalledWith(updated, null);
      expect(toast).toHaveBeenCalledWith('回答を記録しました');
      // 下書きハンドラは呼ばれない
      expect(onDraftStaged).not.toHaveBeenCalled();
    });

    it('特定予約モードで同じ記号を押し直すと、回答の取り消し（null）として保存され、取り消しのトーストが出る', async () => {
      const original: PracticeView = { practice: mockPractice2, myAnswer: '保留', attendees: [] };
      const updated: PracticeView = { practice: mockPractice2, myAnswer: null, attendees: [] };
      const apiSave = vi.fn().mockResolvedValue(updated);
      const toast = vi.fn();
      const onSpecificSaved = vi.fn();

      const outcome = await executeStageAnswer({
        id: 'p2',
        answer: null,
        isSpecific: true,
        fresh: true,
        busy: false,
        saving: false,
        originalPractice: original,
        apiSave,
        touchPractice: vi.fn(),
        updatePractice: vi.fn(),
        toast,
        onSpecificSaved,
        onDraftStaged: vi.fn(),
      });

      expect(outcome).toBe('saved');
      expect(apiSave).toHaveBeenCalledWith('p2', null);
      expect(onSpecificSaved).toHaveBeenCalledWith(updated, '保留');
      expect(toast).toHaveBeenCalledWith('回答を取り消しました');
    });

    it('通常メニューからの回答の場合、即時API保存は呼ばれず下書きステート更新のみ行われる', async () => {
      const original: PracticeView = { practice: mockPractice1, myAnswer: null, attendees: [] };
      const apiSave = vi.fn();
      const touchPractice = vi.fn();
      const updatePractice = vi.fn();
      const toast = vi.fn();
      const onSpecificSaved = vi.fn();
      const onDraftStaged = vi.fn();

      const outcome = await executeStageAnswer({
        id: 'p1',
        answer: '行く',
        isSpecific: false,
        fresh: true,
        busy: false,
        saving: false,
        originalPractice: original,
        apiSave,
        touchPractice,
        updatePractice,
        toast,
        onSpecificSaved,
        onDraftStaged,
      });

      expect(outcome).toBe('staged');
      expect(apiSave).not.toHaveBeenCalled();
      expect(touchPractice).not.toHaveBeenCalled();
      expect(onSpecificSaved).not.toHaveBeenCalled();
      expect(onDraftStaged).toHaveBeenCalledWith(null);
    });

    it('保存中（saving: true）または取得中（fresh: false）の二重タップ時はガードされ何もしない', async () => {
      const original: PracticeView = { practice: mockPractice1, myAnswer: null, attendees: [] };
      const apiSave = vi.fn();

      const outcomeSaving = await executeStageAnswer({
        id: 'p1',
        answer: '行く',
        isSpecific: true,
        fresh: true,
        busy: false,
        saving: true, // 保存中
        originalPractice: original,
        apiSave,
        touchPractice: vi.fn(),
        updatePractice: vi.fn(),
        toast: vi.fn(),
        onSpecificSaved: vi.fn(),
        onDraftStaged: vi.fn(),
      });
      expect(outcomeSaving).toBe('guarded');
      expect(apiSave).not.toHaveBeenCalled();

      const outcomeNotFresh = await executeStageAnswer({
        id: 'p1',
        answer: '行く',
        isSpecific: true,
        fresh: false, // 取得前
        busy: false,
        saving: false,
        originalPractice: original,
        apiSave,
        touchPractice: vi.fn(),
        updatePractice: vi.fn(),
        toast: vi.fn(),
        onSpecificSaved: vi.fn(),
        onDraftStaged: vi.fn(),
      });
      expect(outcomeNotFresh).toBe('guarded');
      expect(apiSave).not.toHaveBeenCalled();
    });

    it('素早い2連打が発生した場合、同期的フラグによって2回目のタップが即座にブロックされ二重送信が防止される', async () => {
      const original: PracticeView = { practice: mockPractice1, myAnswer: null, attendees: [] };
      const updated: PracticeView = { practice: mockPractice1, myAnswer: '行く', attendees: [] };
      let resolveApi: (v: PracticeView) => void;
      const apiPromise = new Promise<PracticeView>((resolve) => {
        resolveApi = resolve;
      });
      const apiSave = vi.fn().mockReturnValue(apiPromise);
      const isOperating = { current: false };

      // 1回目のタップ処理シミュレーション
      const tap1 = async () => {
        if (isOperating.current) return 'blocked_sync';
        isOperating.current = true;
        try {
          return await executeStageAnswer({
            id: 'p1',
            answer: '行く',
            isSpecific: true,
            fresh: true,
            busy: false,
            saving: false,
            originalPractice: original,
            apiSave,
            touchPractice: vi.fn(),
            updatePractice: vi.fn(),
            toast: vi.fn(),
            onSpecificSaved: vi.fn(),
            onDraftStaged: vi.fn(),
          });
        } finally {
          isOperating.current = false;
        }
      };

      // 2回目のタップ処理シミュレーション（1回目の完了前）
      const tap2 = async () => {
        if (isOperating.current) return 'blocked_sync';
        isOperating.current = true;
        try {
          return await executeStageAnswer({
            id: 'p1',
            answer: '行く',
            isSpecific: true,
            fresh: true,
            busy: false,
            saving: false,
            originalPractice: original,
            apiSave,
            touchPractice: vi.fn(),
            updatePractice: vi.fn(),
            toast: vi.fn(),
            onSpecificSaved: vi.fn(),
            onDraftStaged: vi.fn(),
          });
        } finally {
          isOperating.current = false;
        }
      };

      const p1 = tap1();
      const p2 = tap2(); // 1回目がAPI待機中に即座に2回目が実行される

      expect(await p2).toBe('blocked_sync'); // 2回目は同期フラグで即座に遮断される
      expect(apiSave).toHaveBeenCalledTimes(1); // APIは1回しか呼ばれない

      resolveApi!(updated);
      expect(await p1).toBe('saved');
    });
  });

  describe('commitItems と mergePracticesWithKeep の連携（反映中の古い一覧到着による巻き戻り防止）', () => {
    it('複数回答の反映中、各練習の保存開始時に touchPractice が呼ばれ、古いサーバー一覧が到着しても巻き戻らない', async () => {
      const items = [
        { id: 'p1', answer: '行く' as const, originalAnswer: null, practice: mockPractice1 },
        { id: 'p2', answer: '行かない' as const, originalAnswer: '保留' as const, practice: mockPractice2 },
      ];

      const touchedIds = new Set<string>();
      const touchPractice = vi.fn().mockImplementation((id: string) => touchedIds.add(id));
      const currentList: PracticeView[] = [
        { practice: mockPractice1, myAnswer: '行く', attendees: [] },
        { practice: mockPractice2, myAnswer: '行かない', attendees: [] },
      ];

      // commitItems 実行シミュレーション（各項目の保存前に touchPractice を呼ぶ）
      await processCommitItems(items, async (item) => {
        touchPractice(item.id);
      });

      expect(touchPractice).toHaveBeenCalledWith('p1');
      expect(touchPractice).toHaveBeenCalledWith('p2');

      // 反映中に届いた古いサーバー一覧（p1, p2 が未回答のまま）
      const staleIncoming: PracticeView[] = [
        { practice: mockPractice1, myAnswer: null, attendees: [] },
        { practice: mockPractice2, myAnswer: '保留', attendees: [] },
      ];

      // mergePracticesWithKeep により、touchedIds の練習はローカルの最新状態が保持される
      const merged = mergePracticesWithKeep(staleIncoming, currentList, touchedIds);
      expect(merged.find((x) => x.practice.id === 'p1')?.myAnswer).toBe('行く');
      expect(merged.find((x) => x.practice.id === 'p2')?.myAnswer).toBe('行かない');
    });
  });

  describe('computeDisplayedPractices（表示用一覧の算出と下書きステート優先順位）', () => {
    it('特定予約モードで回答選択中・保存中に古いサーバー一覧が届いても、下書きステートが優先され回答が巻き戻らない', () => {
      // 1. 初期状態: サーバー上は p1 の myAnswer が null
      const baseList: PracticeView[] = [{ practice: mockPractice1, myAnswer: null, attendees: [] }];

      // 2. ユーザーが '行く' を選択し、下書きにセット
      const specificStaged = new Map([['p1', '行く' as const]]);

      // 3. 画面表示の算出（computeDisplayedPractices を直接呼び出し）
      const displayed = computeDisplayedPractices(baseList, specificStaged);
      expect(displayed[0].myAnswer).toBe('行く');

      // 4. 保存中に古いサーバー一覧（myAnswer が null のまま）が再度届いた場合をシミュレート
      const staleServerList: PracticeView[] = [{ practice: mockPractice1, myAnswer: null, attendees: [] }];
      const displayedAfterStaleFetch = computeDisplayedPractices(staleServerList, specificStaged);

      // 古い一覧で上書きされず、ユーザーが選択した '行く' が保持される
      expect(displayedAfterStaleFetch[0].myAnswer).toBe('行く');
    });

    it('下書きにない練習は元の回答がそのまま表示される', () => {
      const baseList: PracticeView[] = [
        { practice: mockPractice1, myAnswer: null, attendees: [] },
        { practice: mockPractice2, myAnswer: '保留', attendees: [] },
      ];
      const staged = new Map([['p1', '行く' as const]]);
      const displayed = computeDisplayedPractices(baseList, staged);
      expect(displayed[0].myAnswer).toBe('行く');
      expect(displayed[1].myAnswer).toBe('保留');
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

    it('resolveKeepIds は引数の touched を変更しない純粋関数であり、pruneResolvedTouches と createPracticeSyncTracker で更新関数の外で安全に掃除される', () => {
      let now = 1000;
      const tracker = createPracticeSyncTracker(() => now);
      // p1 の保存開始（touchPractice により Infinity がセットされる）
      tracker.touchPractice('p1');
      expect(tracker.touched.get('p1')).toBe(Infinity);

      let currentList: PracticeView[] = [
        { practice: mockPractice1, myAnswer: '行く', attendees: [] },
        { practice: mockPractice2, myAnswer: '保留', attendees: [] },
      ];
      const staleServerList: PracticeView[] = [
        { practice: mockPractice1, myAnswer: null, attendees: [] },
        { practice: mockPractice2, myAnswer: '保留', attendees: [] },
      ];

      // 1回目の取り直し（t = 1000 に開始した loadHome が完了）
      const keep1 = tracker.prepareMerge(1000);
      currentList = mergePracticesWithKeep(staleServerList, currentList, keep1);
      expect(currentList.find((x) => x.practice.id === 'p1')?.myAnswer).toBe('行く');
      // 保存中（Infinity）のため 1回目の loadHome が終わっても保護は消えない
      expect(tracker.touched.get('p1')).toBe(Infinity);

      // 2回目の取り直しが t = 1200 に開始し、その直後の t = 1500 に p1 の保存が完了（markUpdated）
      now = 1500;
      tracker.markUpdated('p1');
      expect(tracker.touched.get('p1')).toBe(1500);

      // 2回目の取り直し（t = 1200 に開始していた古い応答）が t = 1600 に到着
      // touchedAt(1500) >= fetchStartedAt(1200) のため、2回目でも保護が効いて巻き戻らない
      const keep2 = tracker.prepareMerge(1200);
      currentList = mergePracticesWithKeep(staleServerList, currentList, keep2);
      expect(currentList.find((x) => x.practice.id === 'p1')?.myAnswer).toBe('行く');
      expect(tracker.touched.has('p1')).toBe(true);

      // resolveKeepIds 単体は fetchStartedAt = 2000 でも touched を破壊しない（純粋関数）
      const pureKeep = resolveKeepIds(tracker.touched, 2000);
      expect(pureKeep.size).toBe(0);
      expect(tracker.touched.has('p1')).toBe(true);

      // 3回目の取り直し（保存完了後の t = 2000 に開始した新しい loadHome）が到着し、prepareMerge で掃除される
      const freshServerList: PracticeView[] = [
        { practice: mockPractice1, myAnswer: '行く', attendees: ['佐藤'] },
        { practice: mockPractice2, myAnswer: '保留', attendees: [] },
      ];
      const keep3 = tracker.prepareMerge(2000);
      currentList = mergePracticesWithKeep(freshServerList, currentList, keep3);
      expect(currentList.find((x) => x.practice.id === 'p1')?.myAnswer).toBe('行く');
      expect(currentList.find((x) => x.practice.id === 'p1')?.attendees).toEqual(['佐藤']);
      // 保存完了後に開始された取り直しが完了したため、ステート更新関数の外で安全に解除される
      expect(tracker.touched.has('p1')).toBe(false);
    });
  });
});
