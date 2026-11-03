import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Answer, AttendeeView, PracticeStatus, PracticeView } from '@studio-attendance/shared';
import {
  buildMonthDays,
  formatYearMonth,
  getDayDotSummary,
  getNextMonth,
  getPrevMonth,
  groupPracticesByDate,
  readScheduleViewMode,
  resolveInitialSelectedDate,
  saveScheduleViewMode,
} from '../src/pages/calendarLogic';

function createMockPracticeView(partial: {
  id: string;
  date: string;
  start?: string;
  end?: string;
  studio?: string;
  room?: string;
  fee?: number;
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
      max: null,
      min: null,
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
    goingCount: 0,
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
      const janDays = buildMonthDays(2027, 1);
      const prevDec = janDays.find((d) => d.month === 12);
      if (prevDec) {
        expect(prevDec.year).toBe(2026);
      }

      const decDays = buildMonthDays(2026, 12);
      const nextJan = decDays.find((d) => d.month === 1);
      if (nextJan) {
        expect(nextJan.year).toBe(2027);
      }
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

  describe('groupPracticesByDate & getDayDotSummary（予約情報のマッピングとドット集計）', () => {
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

    it('getDayDotSummary が「行く」と「その他」の件数を正確に返す', () => {
      const p1 = createMockPracticeView({ id: 'p1', date: '2026-11-10', myAnswer: '行く' });
      const p2 = createMockPracticeView({ id: 'p2', date: '2026-11-10', myAnswer: '保留' });
      const p3 = createMockPracticeView({ id: 'p3', date: '2026-11-10', myAnswer: null });

      const summary = getDayDotSummary([p1, p2, p3]);
      expect(summary.goingCount).toBe(1);
      expect(summary.otherCount).toBe(2);
      expect(summary.totalCount).toBe(3);

      expect(getDayDotSummary(undefined)).toEqual({ goingCount: 0, otherCount: 0, totalCount: 0 });
      expect(getDayDotSummary([])).toEqual({ goingCount: 0, otherCount: 0, totalCount: 0 });
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

    it('今日以降の予約情報がない場合は今日を選ぶ', () => {
      const map = new Map<string, PracticeView[]>();
      map.set('2026-11-01', [createMockPracticeView({ id: 'p0', date: '2026-11-01' })]);

      const selected = resolveInitialSelectedDate(2026, 11, map, '2026-11-15');
      expect(selected).toBe('2026-11-15');
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
});
