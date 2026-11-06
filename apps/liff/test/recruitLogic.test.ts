import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PracticeView } from '@studio-attendance/shared';
import {
  filterRecruitPractices,
  readRecruitScope,
  saveRecruitScope,
  type RecruitScope,
} from '../src/pages/recruitLogic';

function createMockPractice(id: string, booker: string, canEdit = true): PracticeView {
  return {
    practice: {
      id,
      date: '2026-11-10',
      start: '18:00',
      end: '20:00',
      studio: 'worcle',
      room: '101',
      fee: 3000,
      booker,
      status: '募集中',
      groups: ['G1'],
      createdAt: '2026-11-01T10:00:00.000Z',
    },
    inList: true,
    canEdit,
    myAnswer: null,
    going: [],
    maybe: [],
    notGoing: [],
    unknown: [],
    goingCount: 0,
    maybeCount: 0,
    notGoingCount: 0,
    unknownCount: 0,
    perPerson: 3000,
    groupNames: ['グループ1'],
  } as unknown as PracticeView;
}

describe('募集ロジック（recruitLogic）', () => {
  let store: Map<string, string>;
  let originalLocalStorage: Storage;

  beforeEach(() => {
    store = new Map<string, string>();
    originalLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      length: 0,
      key: () => null,
    };
  });

  afterEach(() => {
    globalThis.localStorage = originalLocalStorage;
  });

  describe('readRecruitScope / saveRecruitScope', () => {
    it('初期値は mine であり、保存した値が次回読み出せる', () => {
      expect(readRecruitScope()).toBe('mine');
      saveRecruitScope('all');
      expect(readRecruitScope()).toBe('all');
      saveRecruitScope('mine');
      expect(readRecruitScope()).toBe('mine');
    });

    it('不正な値が localStorage にある場合は mine にフォールバックする', () => {
      localStorage.setItem('pb:recruitScope', 'invalid');
      expect(readRecruitScope()).toBe('mine');
    });
  });

  describe('filterRecruitPractices', () => {
    const pMine = createMockPractice('p1', 'U_ME', true);
    const pOther = createMockPractice('p2', 'U_OTHER', true);
    const pCannotEdit = createMockPractice('p3', 'U_OTHER', false);
    const list = [pMine, pOther, pCannotEdit];

    it('一般ユーザー（isAdmin = false）の場合、scopeに関わらず編集可能な予約情報のみを返す', () => {
      const res = filterRecruitPractices(list, false, 'U_ME', 'all');
      expect(res.shown.map((v) => v.practice.id)).toEqual(['p1', 'p2']);
      expect(res.mine.map((v) => v.practice.id)).toEqual(['p1']);
    });

    it('管理者（isAdmin = true）で scope = mine の場合、自分が予約者のもののみを返す', () => {
      const res = filterRecruitPractices(list, true, 'U_ME', 'mine');
      expect(res.shown.map((v) => v.practice.id)).toEqual(['p1']);
      expect(res.mine).toHaveLength(1);
      expect(res.all).toHaveLength(2);
    });

    it('管理者（isAdmin = true）で scope = all の場合、すべての編集可能な予約情報を返す', () => {
      const res = filterRecruitPractices(list, true, 'U_ME', 'all');
      expect(res.shown.map((v) => v.practice.id)).toEqual(['p1', 'p2']);
      expect(res.mine).toHaveLength(1);
      expect(res.all).toHaveLength(2);
    });

    it('practices が null / undefined の場合、空配列を返す', () => {
      const res = filterRecruitPractices(null, true, 'U_ME', 'mine');
      expect(res.shown).toEqual([]);
      expect(res.mine).toEqual([]);
      expect(res.all).toEqual([]);
    });
  });
});
