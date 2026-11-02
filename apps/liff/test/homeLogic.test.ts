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
  parseChangelog,
  syncPracticeNotices,
  updatePracticeSnapshot,
} from '../src/pages/homeLogic';
import { resolveActiveNavKey } from '../src/ui';
import { resolveInitialHash } from '../src/route';

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
      expect(notices[0].title).toBe('けんたさんが「行く」と回答しました');
      expect(notices[1].title).toBe('みおさんが「未定」と回答しました');
    });

    it('出欠行の更新日時（updatedAt）が空文字の場合でも、practice.createdAt や nowIso に安全にフォールバックしてお知らせ時刻が空にならない', () => {
      const me = createMockMe();
      const p = createMockPracticeView({
        id: 'p-empty-ts',
        booker: 'Ume',
        date: '2026-11-10',
        createdAt: '2026-11-01T12:00:00.000Z',
        going: [
          createAttendee('U3', 'けんた', '行く', ''), // 空文字
        ],
      });

      // 1. buildHomeNotices 時（初期表示）: updatedAt が空文字でも p.createdAt にフォールバックする
      const notices = buildHomeNotices([p], me, '2026-11-02');
      expect(notices).toHaveLength(1);
      expect(notices[0].updatedAt).toBe('2026-11-01T12:00:00.000Z');
      expect(notices[0].id).toBe('ans:p-empty-ts:U3:2026-11-01T12:00:00.000Z');

      // 2. syncPracticeNotices 時（差分検知）: 回答変更時に a.updatedAt が空文字でも nowIso にフォールバックする
      syncPracticeNotices([p], me);
      const changed = createMockPracticeView({
        id: 'p-empty-ts',
        booker: 'Ume',
        date: '2026-11-10',
        createdAt: '2026-11-01T12:00:00.000Z',
        maybe: [
          createAttendee('U3', 'けんた', '保留', ''), // 空文字
        ],
      });
      const nowIso = '2026-11-02T15:00:00.000Z';
      const synced = syncPracticeNotices([changed], me, nowIso);
      const ansNotice = synced.find((n) => n.kind === 'answer');
      expect(ansNotice).toBeDefined();
      expect(ansNotice?.updatedAt).toBe(nowIso);
      expect(ansNotice?.id).toBe(`ans:p-empty-ts:U3:${nowIso}`);
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
      expect(notices[0].title).toBe('けんたさんが回答を変更しました（行く → 未定）');
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

    it('自分が予約者（booker === me.userId）の予約情報が変更・中止された場合、自分宛てには変更・中止通知を生成しない', () => {
      const me = createMockMe(); // userId: 'Ume'
      const initial = createMockPracticeView({
        id: 'p-my-booking',
        booker: 'Ume',
        groups: ['G1'],
        room: '201',
        fee: 4000,
        status: '募集中',
      });
      syncPracticeNotices([initial], me, '2026-11-02T10:00:00.000Z');

      // 部屋・料金を変更
      const changed = createMockPracticeView({
        id: 'p-my-booking',
        booker: 'Ume',
        groups: ['G1'],
        room: '202',
        fee: 5000,
        status: '募集中',
      });
      syncPracticeNotices([changed], me, '2026-11-02T11:00:00.000Z');
      let notices = buildHomeNotices([changed], me, '2026-11-02');
      expect(notices).toHaveLength(0);

      // さらに中止に変更
      const canceled = createMockPracticeView({
        id: 'p-my-booking',
        booker: 'Ume',
        groups: ['G1'],
        room: '202',
        fee: 5000,
        status: '中止',
      });
      syncPracticeNotices([canceled], me, '2026-11-02T12:00:00.000Z');
      notices = buildHomeNotices([canceled], me, '2026-11-02');
      expect(notices).toHaveLength(0);
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
      expect(notices[0].title).toBe('ユウキさんが回答を変更しました（未定 → 行かない）');
    });

    it('updatePracticeSnapshot を呼ぶと、自分が予約情報を編集または中止した後の次回 syncPracticeNotices で変更・中止通知が出ない', () => {
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
      let notices = buildHomeNotices([selfEdited], me, '2026-11-02');
      expect(notices.filter((n) => n.kind === 'practice_changed')).toHaveLength(0);

      // さらに自分で中止にした場合
      const selfCanceled = createMockPracticeView({
        id: 'p-edit',
        booker: 'Ume',
        room: '202',
        fee: 4500,
        status: '中止',
      });
      updatePracticeSnapshot(selfCanceled, me);
      syncPracticeNotices([selfCanceled], me, '2026-11-02T11:00:00.000Z');
      notices = buildHomeNotices([selfCanceled], me, '2026-11-02');
      expect(notices.filter((n) => n.kind === 'practice_canceled')).toHaveLength(0);
    });
  });

  describe('未読・既読管理（getHomeUnreadStatus / markNoticesRead / markReleaseNotesRead）', () => {
    it('初回起動時（既読時刻なし）は過去の既存回答が大量に未読にならないよう unreadNoticesCount が 0 になり、それ以降の新着のみ未読として数える', () => {
      const me = createMockMe();
      const p1 = createMockPracticeView({
        id: 'p1',
        booker: 'Ume',
        going: [createAttendee('U3', 'けんた', '行く', '2026-11-02T10:00:00.000Z')],
      });

      // 1. 初回 sync 前の段階でも readAt === null なので過去の既存回答は未読扱いにならない（未読リリースノートの 1 のみ）
      const statusBeforeSync = getHomeUnreadStatus([p1], me, '2026-11-02');
      expect(statusBeforeSync.unreadNoticesCount).toBe(0);
      expect(statusBeforeSync.hasUnreadReleaseNote).toBe(true);
      expect(statusBeforeSync.totalBadgeCount).toBe(1);

      // 2. 初回 syncPracticeNotices でベースライン既読時刻が設定される
      syncPracticeNotices([p1], me, '2026-11-02T10:05:00.000Z');
      const statusAfterFirstSync = getHomeUnreadStatus([p1], me, '2026-11-02');
      expect(statusAfterFirstSync.unreadNoticesCount).toBe(0);

      // 3. その後に新しい回答や回答変更が来た場合は未読としてカウントされる
      const p1Updated = createMockPracticeView({
        id: 'p1',
        booker: 'Ume',
        going: [
          createAttendee('U3', 'けんた', '行く', '2026-11-02T10:00:00.000Z'),
          createAttendee('U4', 'みお', '行く', '2026-11-02T11:00:00.000Z'),
        ],
      });
      syncPracticeNotices([p1Updated], me, '2026-11-02T11:01:00.000Z');
      const statusWithNewNotice = getHomeUnreadStatus([p1Updated], me, '2026-11-02');
      expect(statusWithNewNotice.unreadNoticesCount).toBe(1);
      expect(statusWithNewNotice.totalBadgeCount).toBe(2);

      // 4. お知らせを既読化
      markNoticesRead(me, '2026-11-02T11:05:00.000Z');
      const statusReadNotices = getHomeUnreadStatus([p1Updated], me, '2026-11-02');
      expect(statusReadNotices.unreadNoticesCount).toBe(0);
      expect(statusReadNotices.hasUnreadReleaseNote).toBe(true);
      expect(statusReadNotices.totalBadgeCount).toBe(1);

      // 5. リリースノートを既読化
      markReleaseNotesRead(me, LATEST_RELEASE_VERSION);
      const statusAllRead = getHomeUnreadStatus([p1Updated], me, '2026-11-02');
      expect(statusAllRead.hasUnreadReleaseNote).toBe(false);
      expect(statusAllRead.totalBadgeCount).toBe(0);
    });

    it('CHANGELOG.md から自動生成されたリリースノートに最新バージョン v1.4.0〜v1.0.0 が含まれ、** などの記号や空項目が残らず、見出し付き入れ子箇条書きがすべて親見出しを引き継ぐ', () => {
      expect(RELEASE_NOTES[0].version).toBe('v1.4.0');
      expect(RELEASE_NOTES[RELEASE_NOTES.length - 1].version).toBe('v1.0.0');
      for (const rel of RELEASE_NOTES) {
        expect(rel.version).toMatch(/^v\d+\.\d+\.\d+$/);
        expect(rel.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(rel.sections.length).toBeGreaterThan(0);
        for (const sec of rel.sections) {
          expect(sec.heading.length).toBeGreaterThan(0);
          expect(sec.items.length).toBeGreaterThan(0);
          for (const item of sec.items) {
            expect(item.trim().length).toBeGreaterThan(0);
            // Markdown の ** などの強調記号が残っていないこと
            expect(item).not.toContain('**');
          }
        }
      }

      // v1.4.0 の親見出し「下のメニューに「RSVP」を追加」の下にある複数の子箇条書きが、いずれも見出しプレフィックスを引き継いでいること
      const v140 = RELEASE_NOTES.find((r) => r.version === 'v1.4.0')!;
      const rsvpSec = v140.sections.find((s) => s.heading === '新しくできること')!;
      const rsvpItems = rsvpSec.items.filter((it) => it.startsWith('下のメニューに「RSVP」を追加: '));
      expect(rsvpItems.length).toBe(2);
      expect(rsvpItems[0]).toContain('下のメニューから「RSVP」を開き');
      expect(rsvpItems[1]).toContain('複数のグループに所属している場合は');

      const customParsed = parseChangelog('## v1.5.0（2026-11-03）\n\n### 新しくできること\n- **ホーム画面**:\n  - お知らせを見られます。\n  - リリースノートも見られます。');
      expect(customParsed).toHaveLength(1);
      expect(customParsed[0].version).toBe('v1.5.0');
      expect(customParsed[0].sections[0].items).toEqual([
        'ホーム画面: お知らせを見られます。',
        'ホーム画面: リリースノートも見られます。',
      ]);
    });

    it('CHANGELOG.md の解析結果が空の場合、未読リリースノートは false になる', () => {
      const emptyNotes = parseChangelog('');
      expect(emptyNotes).toEqual([]);

      const nonMatchingNotes = parseChangelog('# ただのドキュメント\n\n箇条書きのみ\n- アイテム');
      expect(nonMatchingNotes).toEqual([]);

      // RELEASE_NOTES が空のときは getHomeUnreadStatus の hasUnreadReleaseNote が false になる
      // （※モック環境で LATEST_RELEASE_VERSION が空または RELEASE_NOTES が空の場合の挙動）
      const me = createMockMe();
      const status = getHomeUnreadStatus([], me, '2026-11-02');
      // 現在の実データでは RELEASE_NOTES があるため、markReleaseNotesRead で既読化すれば false になる
      markReleaseNotesRead(me, LATEST_RELEASE_VERSION);
      expect(getHomeUnreadStatus([], me, '2026-11-02').hasUnreadReleaseNote).toBe(false);

      // version が空文字の場合は markReleaseNotesRead が何もしない
      markReleaseNotesRead(me, '');
    });

    it('formatNoticeTime が ISO 文字列を JST の MM/DD HH:mm 形式に整形する', () => {
      expect(formatNoticeTime('2026-11-02T10:30:00.000Z')).toBe('11/02 19:30');
      expect(formatNoticeTime('invalid')).toBe('');
    });

    it('壊れたスナップショット（answers 欠落や不正 JSON）が localStorage にあっても例外にならず安全に同期できる', () => {
      const me = createMockMe();
      const p1 = createMockPracticeView({
        id: 'p1',
        booker: me.member.userId,
        going: [createAttendee('U2', 'メンバー2', '行く')],
      });

      // answers プロパティが存在しない壊れたスナップショット
      localStorage.setItem(
        'pb:practiceSnapshots:Ume_self',
        JSON.stringify({
          p1: {
            status: '募集中',
            date: '2026-11-10',
            start: '18:00',
            end: '21:00',
            studio: 'worcle',
            room: '202',
            fee: 4400,
            // answers が欠落している
          },
        }),
      );

      // syncPracticeNotices が TypeError を起こさずに安全に実行完了すること
      expect(() => {
        syncPracticeNotices([p1], me);
      }).not.toThrow();

      // 不正な JSON 文字列が localStorage にある場合
      localStorage.setItem('pb:practiceSnapshots:Ume_self', '{ invalid json syntax');
      expect(() => {
        syncPracticeNotices([p1], me);
      }).not.toThrow();
    });

    it('syncPracticeNotices は予期せぬ引数や例外時にも例外を外に漏らさず空配列を返す（アプリ起動時の安全性を保証）', () => {
      const me = createMockMe();
      // practices に null や undefined が紛れ込んだ場合でもクラッシュせず空配列を返す
      expect(() => {
        const result = syncPracticeNotices(null as unknown as PracticeView[], me);
        expect(result).toEqual([]);
      }).not.toThrow();
    });

    it('resolveActiveNavKey が各画面パスに対して正しい下部ナビのタブキーを返す（/feedback や /admin はアカウント扱い）', () => {
      expect(resolveActiveNavKey(['home'])).toBe('home');
      expect(resolveActiveNavKey([])).toBe('');
      expect(resolveActiveNavKey(['p', 'p1'])).toBe('');
      expect(resolveActiveNavKey(['recruit'])).toBe('recruit');
      expect(resolveActiveNavKey(['register'])).toBe('recruit');
      expect(resolveActiveNavKey(['answer'])).toBe('answer');
      expect(resolveActiveNavKey(['settings'])).toBe('settings');
      expect(resolveActiveNavKey(['admin'])).toBe('settings');
      expect(resolveActiveNavKey(['feedback'])).toBe('settings');
    });

    it('resolveInitialHash は LINE 外（isInClient: false）でも ?p= や ?r= がある場合は /home に上書きせず既存の配布リンク先を開く', () => {
      // 予約詳細の共有リンク（?p=p123）
      expect(
        resolveInitialHash(new URLSearchParams('p=p123'), { currentHash: '', isInClient: false }),
      ).toBe('/p/p123');

      // RSVP回答依頼の配布リンク（?r=p1）
      expect(
        resolveInitialHash(new URLSearchParams('r=p1'), { currentHash: '', isInClient: false }),
      ).toBe('/answer?r=p1');

      // 募集管理リンク（?manage=p123）
      expect(
        resolveInitialHash(new URLSearchParams('manage=p123'), { currentHash: '', isInClient: false }),
      ).toBe('/recruit/p123');

      // パラメータなしの外部ブラウザ通常起動時のみ /home が返る
      expect(
        resolveInitialHash(new URLSearchParams(''), { currentHash: '', isInClient: false }),
      ).toBe('/home');
    });
  });
});
