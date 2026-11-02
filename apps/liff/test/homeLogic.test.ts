import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Answer, AttendeeView, MeView, PracticeStatus, PracticeView } from '@studio-attendance/shared';
import {
  LATEST_RELEASE_VERSION,
  RELEASE_NOTES,
  buildHomeNotices,
  formatNoticeTime,
  getHomeUnreadStatus,
  getNextGoingPractice,
  isRelatedForNotice,
  markNoticesRead,
  markReleaseNotesRead,
  syncPracticeNotices,
  updatePracticeSnapshot,
} from '../src/pages/homeLogic';

function createMockMe(partial?: Partial<MeView['member']>, actAs: MeView['actAs'] = 'self'): MeView {
  return {
    member: {
      userId: 'Ume',
      name: 'おおゆち',
      role: '管理者',
      defaultGroups: ['G1'],
      groups: ['G1', 'G2'],
      ...partial,
    },
    groups: [
      { id: 'G1', name: 'ショーケース組' },
      { id: 'G2', name: 'サークル全体' },
      { id: 'G3', name: 'バトル練習会' },
    ],
    settings: {
      studios: [],
      fees: [],
      cancelRules: [],
      minDefault: 3,
      roundUnit: 10,
      groups: [],
    },
    actAs,
    canSwitch: true,
  };
}

function createAttendee(
  participant: string,
  name: string,
  answer: Answer,
  updatedAt = '2026-11-02T10:00:00.000Z',
): AttendeeView {
  return {
    participant,
    name,
    kind: 'メンバー',
    via: 'アプリ',
    answer,
    addedByName: null,
    canRemove: false,
    updatedAt,
  };
}

function createMockPracticeView(partial: {
  id: string;
  date?: string;
  start?: string;
  end?: string;
  studio?: string;
  room?: string;
  fee?: number;
  memo?: string;
  booker?: string;
  status?: PracticeStatus;
  groups?: string[];
  myAnswer?: Answer | null;
  involved?: boolean;
  going?: AttendeeView[];
  maybe?: AttendeeView[];
  notGoing?: AttendeeView[];
  createdAt?: string;
}): PracticeView {
  const going = partial.going ?? [];
  const maybe = partial.maybe ?? [];
  const notGoing = partial.notGoing ?? [];
  return {
    practice: {
      id: partial.id,
      date: partial.date ?? '2026-11-10',
      start: partial.start ?? '18:00',
      end: partial.end ?? '21:00',
      studio: partial.studio ?? 'studio worcle 横浜',
      room: partial.room ?? '202',
      fee: partial.fee ?? 4400,
      booker: partial.booker ?? 'Ume',
      max: null,
      min: null,
      memo: partial.memo ?? '',
      status: partial.status ?? '募集中',
      groups: partial.groups ?? ['G1'],
      feeOverride: null,
      warned: false,
      createdAt: partial.createdAt ?? '2026-11-01T00:00:00.000Z',
    },
    bookerName: partial.booker === 'U2' ? 'さくら' : 'おおゆち',
    groupNames: ['ショーケース組'],
    going,
    maybe,
    notGoing,
    goingCount: going.length,
    perPerson: null,
    myAnswer: partial.myAnswer ?? null,
    involved: partial.involved ?? false,
    canEdit: true,
    joinUrl: null,
    icsUrl: '',
    googleCalendarUrl: '',
  };
}

describe('ホーム画面ロジック（homeLogic）', () => {
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

  describe('getNextGoingPractice（次の参加予定）', () => {
    it('自分が「行く」と回答しており、未終了かつ中止でない直近の予約情報を返す', () => {
      const pPast = createMockPracticeView({ id: 'p-past', date: '2026-11-01', myAnswer: '行く' });
      const pCanceled = createMockPracticeView({ id: 'p-cancel', date: '2026-11-05', myAnswer: '行く', status: '中止' });
      const pMaybe = createMockPracticeView({ id: 'p-maybe', date: '2026-11-06', myAnswer: '保留' });
      const pGoingLater = createMockPracticeView({ id: 'p-later', date: '2026-11-15', start: '19:00', myAnswer: '行く' });
      const pGoingNext = createMockPracticeView({ id: 'p-next', date: '2026-11-08', start: '18:00', myAnswer: '行く' });

      const next = getNextGoingPractice(
        [pPast, pCanceled, pMaybe, pGoingLater, pGoingNext],
        '2026-11-02',
        '12:00',
      );
      expect(next?.practice.id).toBe('p-next');
    });

    it('該当する「行く」予約情報がない場合は null を返す', () => {
      const pMaybe = createMockPracticeView({ id: 'p-maybe', date: '2026-11-06', myAnswer: '保留' });
      expect(getNextGoingPractice([pMaybe], '2026-11-02')).toBeNull();
      expect(getNextGoingPractice(null, '2026-11-02')).toBeNull();
    });
  });

  describe('buildHomeNotices & syncPracticeNotices（お知らせの抽出・変更検知）', () => {
    it('① 自分が「予約者」の予約情報に対する他メンバーの回答のみをお知らせに抽出し、他人が予約者の回答は出さない', () => {
      const me = createMockMe();
      const myBooked = createMockPracticeView({
        id: 'p-mine',
        booker: 'Ume',
        date: '2026-11-10',
        going: [
          createAttendee('Ume', 'おおゆち', '行く', '2026-11-02T09:00:00.000Z'), // 自分自身は除外
          createAttendee('U3', 'けんた', '行く', '2026-11-02T11:00:00.000Z'),
        ],
        maybe: [createAttendee('U4', 'みお', '保留', '2026-11-02T10:30:00.000Z')],
      });
      const otherBooked = createMockPracticeView({
        id: 'p-other',
        booker: 'U2',
        date: '2026-11-12',
        going: [createAttendee('U3', 'けんた', '行く', '2026-11-02T12:00:00.000Z')],
      });

      const notices = buildHomeNotices([myBooked, otherBooked], me, '2026-11-02');
      expect(notices).toHaveLength(2);
      expect(notices[0].title).toBe('けんたさんが「○ 行く」と回答しました');
      expect(notices[1].title).toBe('みおさんが「△ 未定」と回答しました');
    });

    it('② 自分が予約者の予約情報で他メンバーが回答を変更した際、変更前→変更後の通知を生成する', () => {
      const me = createMockMe();
      const initial = createMockPracticeView({
        id: 'p1',
        booker: 'Ume',
        going: [createAttendee('U3', 'けんた', '行く', '2026-11-02T10:00:00.000Z')],
      });
      syncPracticeNotices([initial], me, '2026-11-02T10:05:00.000Z');

      const updated = createMockPracticeView({
        id: 'p1',
        booker: 'Ume',
        maybe: [createAttendee('U3', 'けんた', '保留', '2026-11-02T12:00:00.000Z')],
      });
      syncPracticeNotices([updated], me, '2026-11-02T12:01:00.000Z');

      const notices = buildHomeNotices([updated], me, '2026-11-02');
      expect(notices).toHaveLength(1);
      expect(notices[0].title).toBe('けんたさんが回答を変更しました（○ 行く → △ 未定）');
    });

    it('③ 自分が関係する予約情報の変更（時間・部屋・スタジオ代・メモ）および中止を検知して通知する', () => {
      const me = createMockMe();
      const initial = createMockPracticeView({
        id: 'p2',
        booker: 'U2', // 他人が予約者だが所属グループ G1 の予約
        groups: ['G1'],
        date: '2026-11-15',
        start: '18:00',
        end: '20:00',
        studio: 'BUZZ横浜',
        room: 'Ast',
        fee: 4000,
      });
      syncPracticeNotices([initial], me, '2026-11-02T10:00:00.000Z');

      // 部屋と時間が変更された場合
      const changed = createMockPracticeView({
        id: 'p2',
        booker: 'U2',
        groups: ['G1'],
        date: '2026-11-15',
        start: '18:00',
        end: '21:00',
        studio: 'BUZZ横浜',
        room: 'Bst',
        fee: 6000,
      });
      syncPracticeNotices([changed], me, '2026-11-02T11:00:00.000Z');

      let notices = buildHomeNotices([changed], me, '2026-11-02');
      expect(notices[0].kind).toBe('practice_changed');
      expect(notices[0].title).toContain('の予約情報が変更されました');
      expect(notices[0].detail).toContain('時間: 18:00–20:00 → 18:00–21:00');
      expect(notices[0].detail).toContain('場所: BUZZ横浜 Ast → BUZZ横浜 Bst');
      expect(notices[0].detail).toContain('スタジオ代: ¥4,000 → ¥6,000');

      // さらに中止になった場合
      const canceled = createMockPracticeView({
        ...changed.practice,
        id: 'p2',
        status: '中止',
      });
      syncPracticeNotices([canceled], me, '2026-11-02T12:00:00.000Z');

      notices = buildHomeNotices([canceled], me, '2026-11-02');
      expect(notices[0].kind).toBe('practice_canceled');
      expect(notices[0].title).toContain('の予約情報が中止になりました');
    });

    it('自分が関係しない予約情報（他グループの予約で未回答）の変更は通知しない', () => {
      const me = createMockMe({ groups: ['G1'] });
      const unrelated = createMockPracticeView({
        id: 'p-unrelated',
        booker: 'U2',
        groups: ['G3'], // 自分は G3 に未所属
        room: '101',
      });
      expect(isRelatedForNotice(unrelated, me)).toBe(false);
      syncPracticeNotices([unrelated], me, '2026-11-02T10:00:00.000Z');

      const changedUnrelated = createMockPracticeView({
        id: 'p-unrelated',
        booker: 'U2',
        groups: ['G3'],
        room: '202',
      });
      syncPracticeNotices([changedUnrelated], me, '2026-11-02T11:00:00.000Z');

      const notices = buildHomeNotices([changedUnrelated], me, '2026-11-02');
      expect(notices).toHaveLength(0);
    });

    it('ゲスト（participant = "guest:..."）の回答変更や複数回の変更でも重複せず最新の1件に集約される', () => {
      const me = createMockMe();
      const step1 = createMockPracticeView({
        id: 'p-guest',
        booker: 'Ume',
        going: [createAttendee('guest:abc-123', 'ユウキ', '行く', '2026-11-02T09:00:00.000Z')],
      });
      syncPracticeNotices([step1], me, '2026-11-02T09:05:00.000Z');

      const step2 = createMockPracticeView({
        id: 'p-guest',
        booker: 'Ume',
        maybe: [createAttendee('guest:abc-123', 'ユウキ', '保留', '2026-11-02T10:00:00.000Z')],
      });
      syncPracticeNotices([step2], me, '2026-11-02T10:05:00.000Z');

      const step3 = createMockPracticeView({
        id: 'p-guest',
        booker: 'Ume',
        notGoing: [createAttendee('guest:abc-123', 'ユウキ', '行かない', '2026-11-02T11:00:00.000Z')],
      });
      syncPracticeNotices([step3], me, '2026-11-02T11:05:00.000Z');

      const notices = buildHomeNotices([step3], me, '2026-11-02');
      expect(notices).toHaveLength(1);
      expect(notices[0].title).toBe('ユウキさんが回答を変更しました（△ 未定 → ✕ 行かない）');
    });

    it('updatePracticeSnapshot を呼ぶと、自分が予約情報を編集した後の次回 syncPracticeNotices で変更通知が出ない', () => {
      const me = createMockMe();
      const initial = createMockPracticeView({
        id: 'p-edit',
        booker: 'Ume',
        room: '101',
        fee: 3000,
      });
      syncPracticeNotices([initial], me, '2026-11-02T09:00:00.000Z');

      const selfEdited = createMockPracticeView({
        id: 'p-edit',
        booker: 'Ume',
        room: '202',
        fee: 4500,
      });
      // 自分の編集操作直後にスナップショットを更新
      updatePracticeSnapshot(selfEdited, me);

      // 次回のまとめ取得時
      syncPracticeNotices([selfEdited], me, '2026-11-02T10:00:00.000Z');
      const notices = buildHomeNotices([selfEdited], me, '2026-11-02');
      expect(notices.filter((n) => n.kind === 'practice_changed')).toHaveLength(0);
    });
  });

  describe('未読・既読管理（getHomeUnreadStatus / markNoticesRead / markReleaseNotesRead）', () => {
    it('初期状態ではお知らせ件数＋未読リリースノート(1)がバッジ数になり、既読化すると 0 になる', () => {
      const me = createMockMe();
      const p1 = createMockPracticeView({
        id: 'p1',
        booker: 'Ume',
        going: [createAttendee('U3', 'けんた', '行く', '2026-11-02T10:00:00.000Z')],
      });

      const status1 = getHomeUnreadStatus([p1], me, '2026-11-02');
      expect(status1.unreadNoticesCount).toBe(1);
      expect(status1.hasUnreadReleaseNote).toBe(true);
      expect(status1.totalBadgeCount).toBe(2);

      // お知らせを既読化
      markNoticesRead(me, '2026-11-02T10:00:00.000Z');
      const status2 = getHomeUnreadStatus([p1], me, '2026-11-02');
      expect(status2.unreadNoticesCount).toBe(0);
      expect(status2.hasUnreadReleaseNote).toBe(true);
      expect(status2.totalBadgeCount).toBe(1);

      // リリースノートを既読化
      markReleaseNotesRead(me, LATEST_RELEASE_VERSION);
      const status3 = getHomeUnreadStatus([p1], me, '2026-11-02');
      expect(status3.hasUnreadReleaseNote).toBe(false);
      expect(status3.totalBadgeCount).toBe(0);
    });

    it('リリースノート定義に最新バージョン v1.4.0〜v1.0.0 が含まれている', () => {
      expect(RELEASE_NOTES[0].version).toBe('v1.4.0');
      expect(RELEASE_NOTES[RELEASE_NOTES.length - 1].version).toBe('v1.0.0');
    });

    it('formatNoticeTime が ISO 文字列を JST の MM/DD HH:mm 形式に整形する', () => {
      expect(formatNoticeTime('2026-11-02T10:30:00.000Z')).toBe('11/02 19:30');
      expect(formatNoticeTime('invalid')).toBe('');
    });
  });
});
