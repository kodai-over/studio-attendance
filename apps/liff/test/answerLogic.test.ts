import { describe, expect, it } from 'vitest';
import type { PracticeView } from '@studio-attendance/shared';
import {
  cleanupAfterCommit,
  filterTargetModifiedItems,
  generateSpecificReport,
  getModifiedItems,
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

  describe('filterTargetModifiedItems', () => {
    it('表示中かつ選択グループに該当する項目のみ抽出する', () => {
      const items = [
        { id: 'p1', answer: '行く' as const, originalAnswer: null, practice: mockPractice1 }, // group-a
        { id: 'p2', answer: '行かない' as const, originalAnswer: '保留' as const, practice: mockPractice2 }, // group-b
      ];
      const displayedIds = new Set(['p1', 'p2']);

      // group-a のみ選択
      const filteredA = filterTargetModifiedItems(items, displayedIds, 'group-a');
      expect(filteredA.map((x) => x.id)).toEqual(['p1']);

      // group-b のみ選択
      const filteredB = filterTargetModifiedItems(items, displayedIds, 'group-b');
      expect(filteredB.map((x) => x.id)).toEqual(['p2']);

      // 非表示の項目は除外される
      const filteredPartial = filterTargetModifiedItems(items, new Set(['p2']), 'group-b');
      expect(filteredPartial.map((x) => x.id)).toEqual(['p2']);
    });
  });

  describe('generateSpecificReport', () => {
    it('未回答からの新規回答のみの場合、answerReport 形式のメッセージが生成される', () => {
      const modified = [
        { id: 'p1', answer: '行く' as const, originalAnswer: null, practice: mockPractice1 },
      ];
      const report = generateSpecificReport(mockList, modified);
      expect(report).toContain('○');
      expect(report).toContain('行きます');
    });

    it('回答済からの変更のみの場合、answerChangeReport 形式の差分メッセージが生成される', () => {
      const modified = [
        { id: 'p2', answer: '行く' as const, originalAnswer: '保留' as const, practice: mockPractice2 },
      ];
      const report = generateSpecificReport(mockList, modified);
      expect(report).toContain('未定 → 行く');
    });

    it('新規回答と変更が混在する場合、両方を結合したメッセージが生成される', () => {
      const modified = [
        { id: 'p1', answer: '行く' as const, originalAnswer: null, practice: mockPractice1 },
        { id: 'p2', answer: '行かない' as const, originalAnswer: '保留' as const, practice: mockPractice2 },
      ];
      const report = generateSpecificReport(mockList, modified);
      expect(report).toContain('○');
      expect(report).toContain('未定 → 行かない');
    });

    it('中止の練習はメッセージから除外される', () => {
      const modified = [
        { id: 'p3', answer: '行く' as const, originalAnswer: null, practice: mockPracticeCanceled },
      ];
      const report = generateSpecificReport(mockList, modified);
      expect(report).toBe('');
    });
  });
});
