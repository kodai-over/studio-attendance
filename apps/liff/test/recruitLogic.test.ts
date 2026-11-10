import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Group, PracticeView } from '@studio-attendance/shared';
import {
  canPickForRemind,
  canRemindGroup,
  filterAvailableGroups,
  filterRecruitPractices,
  readRecruitScope,
  sendConfirmMessage,
  defaultRemindTargets,
  resolveRecruitGroups,
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

  describe('filterAvailableGroups / resolveRecruitGroups', () => {
    const allGroups: Group[] = [
      { id: 'g1', name: 'チームA' },
      { id: 'g2', name: 'チームB' },
      { id: 'g3', name: '他チームC' },
    ];

    it('自分が所属しているグループのみを抽出する', () => {
      const myGroups = ['g1', 'g2'];
      const res = filterAvailableGroups(allGroups, myGroups);
      expect(res.map((g) => g.id)).toEqual(['g1', 'g2']);
    });

    it('所属グループが未登録または空の場合、空配列を返す', () => {
      expect(filterAvailableGroups(allGroups, [])).toEqual([]);
      expect(filterAvailableGroups(allGroups, null)).toEqual([]);
      expect(filterAvailableGroups(null, ['g1'])).toEqual([]);
    });

    it('未募集グループと募集済グループを正しく分類する（本人の所属グループのみ対象）', () => {
      const myGroups = ['g1', 'g2'];
      // g1 はすでに募集済み、g3 も募集済みだが本人は所属していない
      const practiceGroups = ['g1', 'g3'];
      const { unrecruited, sent } = resolveRecruitGroups(allGroups, myGroups, practiceGroups);

      // unrecruited には所属かつ未送信の g2 のみ
      expect(unrecruited.map((g) => g.id)).toEqual(['g2']);
      // sent には所属かつ送信済の g1 のみ（g3 は未所属なので含まれない）
      expect(sent.map((g) => g.id)).toEqual(['g1']);
    });
  });

  describe('canRemindGroup / sendConfirmMessage', () => {
    it('満員の場合は canSubmit が false になる', () => {
      const pFull = createMockPractice('p1', 'U_ME', true);
      pFull.practice.status = '満員';
      expect(canRemindGroup(pFull)).toEqual({ canShow: true, canSubmit: false });
    });

    it('確認文は送り先のグループ名を含み、確認用アカウントのときはその旨を添える', () => {
      expect(sendConfirmMessage({ name: 'チームA' })).toBe('チームA に募集カードを送りますか？');
      expect(sendConfirmMessage({ name: 'チームA' }, true)).toBe('確認用アカウント「admin」として、チームA に募集カードを送りますか？');
    });
  });
});

describe('まとめて募集を送る', () => {
  const mk = (over: Partial<PracticeView['practice']> = {}, canEdit = true, groupNames: string[] = ['A組']): PracticeView => {
    const v = createMockPractice('p', 'U1', canEdit);
    return { ...v, groupNames, practice: { ...v.practice, groups: ['G1'], ...over } };
  };

  it('選べるのは、自分で送れる・募集済・募集中・開始前の予約情報だけ', () => {
    expect(canPickForRemind(mk(), '2026-11-10')).toBe(true);
    expect(canPickForRemind(mk({}, false), '2026-11-10')).toBe(false);
    expect(canPickForRemind(mk({ groups: [] }), '2026-11-10')).toBe(false);
    expect(canPickForRemind(mk({ status: '満員' }), '2026-11-10')).toBe(false);
    expect(canPickForRemind(mk({ status: '中止' }), '2026-11-10')).toBe(false);
    expect(canPickForRemind(mk({ date: '2026-11-09' }), '2026-11-10')).toBe(false);
  });

  it('送り先の初期値は、選んだ予約情報の募集済のグループのうち、自分が選べるもの', () => {
    const g = (id: string): Group => ({ id, name: id });
    const picked = [mk({ groups: ['A', 'B'] }), mk({ groups: ['B', 'X'] })];
    expect(defaultRemindTargets(picked, [g('A'), g('B'), g('C')])).toEqual(['A', 'B']);
    expect(defaultRemindTargets(picked, [])).toEqual([]);
  });
});
