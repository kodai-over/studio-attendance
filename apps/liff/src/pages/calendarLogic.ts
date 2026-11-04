import {
  computeCancelDeadline,
  isActive,
  isHoliday,
  toJstDate,
  type CancelRule,
  type PracticeView,
} from '@studio-attendance/shared';

export interface CalendarDay {
  date: string; // 'YYYY-MM-DD'
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  isCurrentMonth: boolean;
  isToday: boolean;
  dayOfWeek: number; // 0: 日, 1: 月, ..., 6: 土
  isHoliday: boolean;
}

export type ScheduleViewMode = 'list' | 'calendar';
export const SCHEDULE_VIEW_MODE_KEY = 'pb:scheduleViewMode';

export function readScheduleViewMode(): ScheduleViewMode {
  try {
    const saved = localStorage.getItem(SCHEDULE_VIEW_MODE_KEY);
    return saved === 'calendar' ? 'calendar' : 'list';
  } catch {
    return 'list';
  }
}

export function saveScheduleViewMode(mode: ScheduleViewMode): void {
  try {
    localStorage.setItem(SCHEDULE_VIEW_MODE_KEY, mode);
  } catch {
    /* localStorage が使えない環境でも動作する */
  }
}

/**
 * 年月（year, month）のカレンダーグリッド用の日付配列（日曜日開始、常に7の倍数）を生成する。
 * 前月末、当月、翌月初の日付を含む。
 */
export function buildMonthDays(
  year: number,
  month: number,
  todayIso = toJstDate(new Date()),
): CalendarDay[] {
  // 当月1日の Date
  const firstDate = new Date(Date.UTC(year, month - 1, 1));
  const startDayOfWeek = firstDate.getUTCDay(); // 0(日) - 6(土)

  // 当月の最終日
  const lastDate = new Date(Date.UTC(year, month, 0));
  const totalDaysInMonth = lastDate.getUTCDate();

  // 前月の最終日
  const prevMonthLastDate = new Date(Date.UTC(year, month - 1, 0));
  const totalDaysInPrevMonth = prevMonthLastDate.getUTCDate();

  const days: CalendarDay[] = [];

  // 前月の日付（startDayOfWeek 分）
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = totalDaysInPrevMonth - i;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const dateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({
      date: dateStr,
      year: prevYear,
      month: prevMonth,
      day: d,
      isCurrentMonth: false,
      isToday: dateStr === todayIso,
      dayOfWeek: new Date(Date.UTC(prevYear, prevMonth - 1, d)).getUTCDay(),
      isHoliday: isHoliday(dateStr),
    });
  }

  // 当月の日付
  for (let d = 1; d <= totalDaysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    days.push({
      date: dateStr,
      year,
      month,
      day: d,
      isCurrentMonth: true,
      isToday: dateStr === todayIso,
      dayOfWeek,
      isHoliday: isHoliday(dateStr),
    });
  }

  // 翌月初の日付（行の最後が土曜日になるよう埋める。7の倍数になるまで）
  const remaining = (7 - (days.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const dateStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({
      date: dateStr,
      year: nextYear,
      month: nextMonth,
      day: d,
      isCurrentMonth: false,
      isToday: dateStr === todayIso,
      dayOfWeek: new Date(Date.UTC(nextYear, nextMonth - 1, d)).getUTCDay(),
      isHoliday: isHoliday(dateStr),
    });
  }

  return days;
}

export function getPrevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function getNextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function formatYearMonth(year: number, month: number): string {
  return `${year}年 ${month}月`;
}

/**
 * 予約情報リストを日付（'YYYY-MM-DD'）ごとにグループ化する。
 */
export function groupPracticesByDate(practices: PracticeView[]): Map<string, PracticeView[]> {
  const map = new Map<string, PracticeView[]>();
  for (const v of practices) {
    const d = v.practice.date;
    const list = map.get(d) ?? [];
    list.push(v);
    map.set(d, list);
  }
  // 開始時間順にソート
  for (const list of map.values()) {
    list.sort((a, b) => a.practice.start.localeCompare(b.practice.start));
  }
  return map;
}

/**
 * カレンダーセル内での予約情報の色分け種別
 * - 'met-min': 最低人数達成（通常・緑系）
 * - 'under-min': 最低人数未達（注意・黄/アンバー系）
 * - 'under-min-urgent': 最低人数未達 かつ キャンセル期限間近(24h以内)または超過（警告・赤系）
 * - 'inactive': 中止または終了（グレー系）
 * - 'neutral': 設定未ロード等による中立（グレー系）
 */
export type CalendarEventTone = 'met-min' | 'under-min' | 'under-min-urgent' | 'inactive' | 'neutral';

export function getCalendarToneLabel(tone: CalendarEventTone): string {
  switch (tone) {
    case 'met-min':
      return '最低人数達成';
    case 'under-min':
      return '最低人数未達';
    case 'under-min-urgent':
      return '最低人数未達かつキャンセル期限間近または超過';
    case 'inactive':
      return '中止または終了';
    case 'neutral':
      return '最低人数未確認';
  }
}

export interface CalendarToneSettings {
  minDefault: number;
  cancelRules: CancelRule[];
}

export function getPracticeCalendarTone(
  v: PracticeView,
  settings?: CalendarToneSettings | null,
  now: Date = new Date(),
): CalendarEventTone {
  const p = v.practice;
  const todayJst = toJstDate(now);
  if (!isActive(p) || p.date < todayJst) {
    return 'inactive';
  }
  if (!settings) {
    return 'neutral';
  }
  const min = p.min ?? settings.minDefault;
  if (v.goingCount >= min) {
    return 'met-min';
  }
  const deadline = computeCancelDeadline(p.date, p.studio, settings.cancelRules ?? [], now);
  if (deadline && (deadline.isSoon || deadline.isPast)) {
    return 'under-min-urgent';
  }
  return 'under-min';
}

/**
 * 該当日に予約情報が存在するか判定する
 */
export function hasPracticeOnDate(practices: PracticeView[], date: string): boolean {
  return practices.some((v) => v.practice.date === date);
}

/**
 * 固定カレンダー下端に合わせたスクロール量を計算する
 */
export function computeScrollOffset(ticketTop: number, stickyBottom: number, gap = 12): number {
  return ticketTop - stickyBottom - gap;
}

/**
 * カレンダーセル内の参加人数（上限ありの場合は「going/max人」）表記
 */
export function formatCalendarCount(v: PracticeView): string {
  const maxPart = v.practice.max != null ? `/${v.practice.max}` : '';
  return `${v.goingCount}${maxPart}人`;
}

/**
 * 初期選択日を決める。
 * 当月で今日以降の最も近い予約情報の日、なければ今日。今日が当月にない場合は当月の予約日の最初、それもなければ1日。
 */
export function resolveInitialSelectedDate(
  year: number,
  month: number,
  practicesByDate: Map<string, PracticeView[]>,
  todayIso = toJstDate(new Date()),
): string {
  const [tY, tM] = todayIso.split('-').map(Number);
  const isThisMonth = tY === year && tM === month;

  // 当月の予約情報がある日付をソート
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const monthDates = Array.from(practicesByDate.keys())
    .filter((d) => d.startsWith(prefix))
    .sort();

  if (isThisMonth) {
    const upcoming = monthDates.find((d) => d >= todayIso);
    return upcoming ?? todayIso;
  }

  return monthDates[0] ?? `${prefix}01`;
}
