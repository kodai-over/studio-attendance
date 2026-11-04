import { useState } from 'preact/hooks';
import { labelDate, toJstDate, type PracticeView } from '@studio-attendance/shared';
import { Icon, useApp } from '../ui';
import {
  buildMonthDays,
  formatCalendarCount,
  formatYearMonth,
  getCalendarToneLabel,
  getNextMonth,
  getPracticeCalendarTone,
  getPrevMonth,
  groupPracticesByDate,
  resolveInitialSelectedDate,
  type CalendarDay,
  type CalendarEventTone,
} from './calendarLogic';

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

export function CalendarEventChip({
  v,
  tone,
}: {
  v: PracticeView;
  tone: CalendarEventTone;
}) {
  const p = v.practice;
  const isCanceled = p.status === '中止';
  const countStr = formatCalendarCount(v);
  const toneLabel = getCalendarToneLabel(tone);
  const chipAriaLabel = isCanceled ? `${countStr} (中止)` : `${countStr} (${toneLabel})`;

  return (
    <div
      class={`cal-event-chip tone-${tone}${isCanceled ? ' is-canceled' : ''}`}
      role="img"
      aria-label={chipAriaLabel}
    >
      <span class="cal-chip-dot" aria-hidden="true" />
    </div>
  );
}

export function CalendarView({
  practices,
  onSelectDate,
  compact = false,
}: {
  practices: PracticeView[];
  onSelectDate?: (date: string) => void;
  /** スクロール中は、選んだ日（なければ今日）の週だけに縮める */
  compact?: boolean;
}) {
  const app = useApp();
  const toneSettings = app?.me?.settings;

  const todayIso = toJstDate(new Date());
  const [tY, tM] = todayIso.split('-').map(Number);

  const [currentYear, setCurrentYear] = useState(tY);
  const [currentMonth, setCurrentMonth] = useState(tM);

  const practicesByDate = groupPracticesByDate(practices);

  // 初期選択日（今日、または直近の予定日）
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    resolveInitialSelectedDate(currentYear, currentMonth, practicesByDate, todayIso),
  );

  const monthDays = buildMonthDays(currentYear, currentMonth, todayIso);
  const anchor = Math.max(
    0,
    [selectedDate, todayIso].map((d) => monthDays.findIndex((x) => x.date === d)).find((i) => i >= 0) ??
      monthDays.findIndex((x) => x.isCurrentMonth),
  );
  const week = Math.floor(anchor / 7);
  const days = compact ? monthDays.slice(week * 7, week * 7 + 7) : monthDays;

  const handlePrevMonth = () => {
    const prev = getPrevMonth(currentYear, currentMonth);
    setCurrentYear(prev.year);
    setCurrentMonth(prev.month);
    setSelectedDate(null);
    onSelectDate?.('');
  };

  const handleNextMonth = () => {
    const next = getNextMonth(currentYear, currentMonth);
    setCurrentYear(next.year);
    setCurrentMonth(next.month);
    setSelectedDate(null);
    onSelectDate?.('');
  };

  const handleToday = () => {
    setCurrentYear(tY);
    setCurrentMonth(tM);
    setSelectedDate(todayIso);
    onSelectDate?.(todayIso);
  };

  const handleSelectDay = (day: CalendarDay) => {
    setSelectedDate(day.date);
    if (!day.isCurrentMonth) {
      setCurrentYear(day.year);
      setCurrentMonth(day.month);
    }
    onSelectDate?.(day.date);
  };

  return (
    <div class={`calendar${compact ? ' compact' : ''}`}>
      <div class="cal-nav">
        <span class="cal-year-month">{formatYearMonth(currentYear, currentMonth)}</span>
        <button
          type="button"
          class="btn plain small"
          onClick={handleToday}
          disabled={currentYear === tY && currentMonth === tM && selectedDate === todayIso}
        >
          今日
        </button>
        <button type="button" class="icon-btn" onClick={handlePrevMonth} aria-label="前月">
          <Icon name="back" size={18} />
        </button>
        <button type="button" class="icon-btn" onClick={handleNextMonth} aria-label="翌月">
          <Icon name="chevron" size={18} />
        </button>
      </div>

      {/* 曜日 */}
      <div class="cal-weekday-row">
        {WEEKDAY_NAMES.map((w, idx) => (
          <div
            key={w}
            class={`cal-weekday-cell ${idx === 0 ? 'sun' : idx === 6 ? 'sat' : ''}`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 日付 */}
      <div class="cal-grid">
        {days.map((day) => {
          const isSelected = day.date === selectedDate;
          const practicesOnDay = practicesByDate.get(day.date) ?? [];

          return (
            <button
              key={day.date}
              type="button"
              class={`cal-day-cell ${day.isCurrentMonth ? 'in-month' : 'other-month'} ${
                day.isToday ? 'is-today' : ''
              } ${isSelected ? 'is-selected' : ''} ${
                day.dayOfWeek === 0 || day.isHoliday ? 'holiday' : day.dayOfWeek === 6 ? 'sat' : ''
              }`}
              onClick={() => handleSelectDay(day)}
              aria-label={`${labelDate(day.date)}${
                practicesOnDay.length > 0 ? ` ${practicesOnDay.length}件の予約情報` : ''
              }`}
              aria-pressed={isSelected}
            >
              <span class="cal-day-num">{day.day}</span>
              {practicesOnDay.length > 0 && (
                <div class="cal-day-events">
                  {practicesOnDay.map((v) => (
                    <CalendarEventChip
                      key={v.practice.id}
                      v={v}
                      tone={getPracticeCalendarTone(v, toneSettings)}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
