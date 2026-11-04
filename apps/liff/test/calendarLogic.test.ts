import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Answer, AttendeeView, PracticeStatus, PracticeView } from '@studio-attendance/shared';
import {
  buildMonthDays,
  formatCalendarCount,
  formatYearMonth,
  getCalendarToneLabel,
  getNextMonth,
  getPracticeCalendarTone,
  getPrevMonth,
  groupPracticesByDate,
  readScheduleViewMode,
  resolveInitialSelectedDate,
  saveScheduleViewMode,
  type CalendarToneSettings,
} from '../src/pages/calendarLogic';
import { CalendarEventChip } from '../src/pages/CalendarView';

function createMockPracticeView(partial: {
  id: string;
  date: string;
  start?: string;
  end?: string;
  studio?: string;
  room?: string;
  fee?: number;
  max?: number | null;
  min?: number | null;
  goingCount?: number;
  myAnswer?: Answer | null;
  status?: PracticeStatus;
}): PracticeView {
  return {
    practice: {
      id: partial.id,
      date: partial.date,
      start: partial.start ?? '18:00',
      end: partial.end ?? '21:00',
      studio: partial.studio ?? 'studio worcle 横浜',
      room: partial.room ?? '202',
      fee: partial.fee ?? 4400,
      booker: 'U1',
      max: partial.max ?? null,
      min: partial.min ?? null,
      memo: '',
      status: partial.status ?? '募集中',
      groups: ['G1'],
      feeOverride: null,
      createdAt: '2026-11-01T10:00:00.000Z',
    },
    inList: true,
    myAnswer: partial.myAnswer ?? null,
    going: [],
    maybe: [],
    notGoing: [],
    unknown: [],
    goingCount: partial.goingCount ?? 0,
    maybeCount: 0,
    notGoingCount: 0,
    unknownCount: 0,
    perPerson: 2200,
    bookerName: '予約者',
  };
}

describe('カレンダーロジック（calendarLogic）', () => {
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

  describe('buildMonthDays（カレンダーグリッドの日付生成）', () => {
    it('2026年11月（1日=日曜日、30日=月曜日）のカレンダーグリッドが7の倍数で正しく生成される', () => {
      // 2026-11-01 は日曜日（startDayOfWeek = 0）
      // 30日は月曜日（最終週は火〜土の5日間が翌月12月）
      // 合計 30 + 5 = 35日
      const days = buildMonthDays(2026, 11, '2026-11-03');
      expect(days.length).toBe(35);
      expect(days.length % 7).toBe(0);

      // 1日目: 2026-11-01 (日)
      expect(days[0].date).toBe('2026-11-01');
      expect(days[0].day).toBe(1);
      expect(days[0].isCurrentMonth).toBe(true);
      expect(days[0].dayOfWeek).toBe(0); // 日曜

      // 3日目: 2026-11-03 (文化の日・祝日、今日指定)
      const nov3 = days.find((d) => d.date === '2026-11-03');
      expect(nov3).toBeDefined();
      expect(nov3?.isToday).toBe(true);
      expect(nov3?.isHoliday).toBe(true); // 文化の日

      // 23日目: 2026-11-23 (勤労感謝の日・祝日)
      const nov23 = days.find((d) => d.date === '2026-11-23');
      expect(nov23?.isHoliday).toBe(true);

      // 最終日: 2026-12-05 (土)
      const last = days[days.length - 1];
      expect(last.date).toBe('2026-12-05');
      expect(last.isCurrentMonth).toBe(false);
      expect(last.dayOfWeek).toBe(6); // 土曜
    });

    it('月初が日曜日以外（前月の埋め込みが必要）の月でも前月末の日付が正しく入る', () => {
      // 2026年12月: 1日は火曜日（前月11/29日、11/30月が先頭に入る）
      const days = buildMonthDays(2026, 12, '2026-12-01');
      expect(days.length % 7).toBe(0);
      expect(days[0].date).toBe('2026-11-29');
      expect(days[0].isCurrentMonth).toBe(false);
      expect(days[0].dayOfWeek).toBe(0); // 日曜
      expect(days[1].date).toBe('2026-11-30');
      expect(days[1].isCurrentMonth).toBe(false);
      expect(days[2].date).toBe('2026-12-01');
      expect(days[2].isCurrentMonth).toBe(true);
    });

    it('1月の前月（前年12月）や12月の翌月（翌年1月）の年またぎが正常に計算される', () => {
      // 2027年1月1日は金曜日。日〜木の5日間が前月2026年12月（12/27〜12/31）
      const janDays = buildMonthDays(2027, 1);
      const prevDec = janDays.find((d) => d.month === 12);
      expect(prevDec).toBeDefined();
      expect(prevDec!.year).toBe(2026);
      expect(prevDec!.date).toBe('2026-12-27');

      // 2026年12月31日は木曜日。金・土の2日間が翌月2027年1月（1/1〜1/2）
      const decDays = buildMonthDays(2026, 12);
      const nextJan = decDays.find((d) => d.month === 1);
      expect(nextJan).toBeDefined();
      expect(nextJan!.year).toBe(2027);
      expect(nextJan!.date).toBe('2027-01-01');
    });

    it('うるう年の2月（29日）と平年の2月（28日）が正確に生成される', () => {
      // 2024年はうるう年（2月は29日まで）
      const leapDays = buildMonthDays(2024, 2);
      const leapInMonth = leapDays.filter((d) => d.isCurrentMonth);
      expect(leapInMonth).toHaveLength(29);
      expect(leapInMonth[28].date).toBe('2024-02-29');

      // 2026年は平年（2月は28日まで）
      const commonDays = buildMonthDays(2026, 2);
      const commonInMonth = commonDays.filter((d) => d.isCurrentMonth);
      expect(commonInMonth).toHaveLength(28);
      expect(commonInMonth[27].date).toBe('2026-02-28');
    });
  });

  describe('年月ナビゲーション（getPrevMonth / getNextMonth / formatYearMonth）', () => {
    it('前月・翌月を年またぎを含めて計算できる', () => {
      expect(getPrevMonth(2026, 11)).toEqual({ year: 2026, month: 10 });
      expect(getPrevMonth(2026, 1)).toEqual({ year: 2025, month: 12 });

      expect(getNextMonth(2026, 11)).toEqual({ year: 2026, month: 12 });
      expect(getNextMonth(2026, 12)).toEqual({ year: 2027, month: 1 });
    });

    it('formatYearMonth が「YYYY年 M月」形式を返す', () => {
      expect(formatYearMonth(2026, 11)).toBe('2026年 11月');
      expect(formatYearMonth(2027, 1)).toBe('2027年 1月');
    });
  });

  describe('groupPracticesByDate（予約情報の日付別マッピング）', () => {
    it('予約情報を日付ごとにまとめ、開始時刻順にソートする', () => {
      const p1 = createMockPracticeView({ id: 'p1', date: '2026-11-10', start: '19:00' });
      const p2 = createMockPracticeView({ id: 'p2', date: '2026-11-10', start: '13:00' });
      const p3 = createMockPracticeView({ id: 'p3', date: '2026-11-15', start: '18:00' });

      const map = groupPracticesByDate([p1, p2, p3]);
      expect(map.size).toBe(2);

      const nov10 = map.get('2026-11-10')!;
      expect(nov10).toHaveLength(2);
      // 13:00 が先、19:00 が後
      expect(nov10[0].practice.id).toBe('p2');
      expect(nov10[1].practice.id).toBe('p1');

      const nov15 = map.get('2026-11-15')!;
      expect(nov15).toHaveLength(1);
    });
  });

  describe('resolveInitialSelectedDate（初期選択日決定）', () => {
    it('当月の場合、今日以降の直近の予約日を優先して選択する', () => {
      const map = new Map<string, PracticeView[]>();
      map.set('2026-11-01', [createMockPracticeView({ id: 'p0', date: '2026-11-01' })]);
      map.set('2026-11-10', [createMockPracticeView({ id: 'p1', date: '2026-11-10' })]);

      // 今日が 2026-11-03 の場合、今日以降の最も近い 2026-11-10 が選ばれる
      const selected = resolveInitialSelectedDate(2026, 11, map, '2026-11-03');
      expect(selected).toBe('2026-11-10');
    });

    it('当月で今日より前の過去の予約情報しかない場合、今日の日付を選択する（今日の状態を明瞭にするため）', () => {
      const map = new Map<string, PracticeView[]>();
      map.set('2026-11-01', [createMockPracticeView({ id: 'p0', date: '2026-11-01' })]);

      // 今日が 2026-11-15 の場合、過去の予定があっても今日が選択される
      const selected = resolveInitialSelectedDate(2026, 11, map, '2026-11-15');
      expect(selected).toBe('2026-11-15');
    });

    it('当月に予約情報が1件もない場合も今日の日付を選択する', () => {
      const map = new Map<string, PracticeView[]>();
      const selected = resolveInitialSelectedDate(2026, 11, map, '2026-11-03');
      expect(selected).toBe('2026-11-03');
    });

    it('別月を表示している場合は、その月の最初の予約日（なければ1日）を選ぶ', () => {
      const map = new Map<string, PracticeView[]>();
      map.set('2026-12-15', [createMockPracticeView({ id: 'p1', date: '2026-12-15' })]);

      const selectedDec = resolveInitialSelectedDate(2026, 12, map, '2026-11-03');
      expect(selectedDec).toBe('2026-12-15');

      const selectedJan = resolveInitialSelectedDate(2027, 1, map, '2026-11-03');
      expect(selectedJan).toBe('2027-01-01');
    });
  });

  describe('表示モード永続化（readScheduleViewMode / saveScheduleViewMode）', () => {
    it('初期状態は list で、保存すると次回読み出せる', () => {
      localStorage.removeItem('pb:scheduleViewMode');
      expect(readScheduleViewMode()).toBe('list');

      saveScheduleViewMode('calendar');
      expect(readScheduleViewMode()).toBe('calendar');

      saveScheduleViewMode('list');
      expect(readScheduleViewMode()).toBe('list');
    });
  });

  describe('getPracticeCalendarTone / formatCalendarPlace / formatCalendarCount（カレンダーセル表示・色分け判定）', () => {
    const toneSettings: CalendarToneSettings = {
      minDefault: 3,
      cancelRules: [{ studio: 'worcle', daysBefore: 4, time: '10:00' }],
    };

    it('参加人数が最低人数以上の場合は met-min になる', () => {
      const v = createMockPracticeView({
        id: 'p1',
        date: '2026-11-10',
        goingCount: 3,
      });
      const now = new Date('2026-11-01T01:00:00Z');
      expect(getPracticeCalendarTone(v, toneSettings, now)).toBe('met-min');
    });

    it('最低人数未達でキャンセル期限まで余裕がある場合は under-min になる', () => {
      // 2026-11-10 の worcle は 4日前 = 2026-11-06 10:00 JST が期限
      const v = createMockPracticeView({
        id: 'p2',
        date: '2026-11-10',
        studio: 'studio worcle 横浜',
        min: 4,
        goingCount: 2,
      });
      const now = new Date('2026-11-03T01:00:00Z'); // 11/3 10:00 JST（期限まで3日）
      expect(getPracticeCalendarTone(v, toneSettings, now)).toBe('under-min');
    });

    it('最低人数未達でキャンセル期限が近い（24時間以内）または過ぎている場合は under-min-urgent になる', () => {
      const v = createMockPracticeView({
        id: 'p3',
        date: '2026-11-10',
        studio: 'studio worcle 横浜',
        min: 4,
        goingCount: 2,
      });
      // 11/5 12:00 JST（期限 11/6 10:00 JST まで22時間 = isSoon）
      const nowSoon = new Date('2026-11-05T03:00:00Z');
      expect(getPracticeCalendarTone(v, toneSettings, nowSoon)).toBe('under-min-urgent');

      // 11/7 12:00 JST（期限超過 = isPast）
      const nowPast = new Date('2026-11-07T03:00:00Z');
      expect(getPracticeCalendarTone(v, toneSettings, nowPast)).toBe('under-min-urgent');
    });

    it('中止または終了の予約情報は inactive になる', () => {
      const canceled = createMockPracticeView({
        id: 'p-canceled',
        date: '2026-11-10',
        status: '中止',
        goingCount: 0,
      });
      expect(getPracticeCalendarTone(canceled, toneSettings)).toBe('inactive');
    });

    it('トーン種別ごとのアクセシビリティ用ラベルが正しく返る', () => {
      expect(getCalendarToneLabel('met-min')).toBe('最低人数達成');
      expect(getCalendarToneLabel('under-min')).toBe('最低人数未達');
      expect(getCalendarToneLabel('under-min-urgent')).toBe('最低人数未達かつ期限間近');
      expect(getCalendarToneLabel('inactive')).toBe('中止または終了');
    });

    it('参加人数（上限あり・なし）のフォーマットが正しく返る', () => {
      const vNoMax = createMockPracticeView({ id: 'p1', date: '2026-11-10', goingCount: 4, max: null });
      expect(formatCalendarCount(vNoMax)).toBe('4人');

      const vWithMax = createMockPracticeView({ id: 'p2', date: '2026-11-10', goingCount: 3, max: 6 });
      expect(formatCalendarCount(vWithMax)).toBe('3/6人');
    });
  });

  describe('CalendarEventChip（カレンダーセル内チップ部品テスト）', () => {
    it('参加人数（上限込み）のみをシンプルに描画し、色分けクラスとaria-labelを適用する', () => {
      const p1 = createMockPracticeView({
        id: 'p1',
        date: '2026-11-10',
        start: '19:00',
        end: '21:00',
        studio: 'studio worcle 横浜',
        room: '202',
        goingCount: 2,
        max: 8,
        status: '募集中',
      });

      const vnode = CalendarEventChip({ v: p1, tone: 'under-min-urgent' });
      expect(vnode).toBeDefined();
      expect(vnode.props.class).toContain('cal-event-chip');
      expect(vnode.props.class).toContain('tone-under-min-urgent');
      expect(vnode.props['aria-label']).toBe('2/8人 (最低人数未達かつ期限間近)');

      const jsonStr = JSON.stringify(vnode);
      expect(jsonStr).toContain('2/8人');
      expect(jsonStr).not.toContain('worcle 横浜 202');
      expect(jsonStr).not.toContain('19:00');
    });

    it('中止の予約情報の場合、is-canceled クラスと tone-inactive、中止のaria-labelが適用される', () => {
      const canceledPractice = createMockPracticeView({
        id: 'p-canceled',
        date: '2026-11-10',
        status: '中止',
        goingCount: 0,
      });

      const vnode = CalendarEventChip({ v: canceledPractice, tone: 'inactive' });
      expect(vnode.props.class).toContain('tone-inactive');
      expect(vnode.props.class).toContain('is-canceled');
      expect(vnode.props['aria-label']).toBe('0人 (中止)');
    });
  });
});
