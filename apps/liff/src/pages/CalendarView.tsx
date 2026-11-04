import { useState } from 'preact/hooks';
import { toJstDate, type PracticeView } from '@studio-attendance/shared';
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
  type CalendarToneSettings,
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
      aria-label={chipAriaLabel}
    >
      <span class="cal-chip-dot" aria-hidden="true" />
      <span class="cal-chip-count">{countStr}</span>
    </div>
  );
}

export function CalendarView({
  practices,
  onSelectDate,
}: {
  practices: PracticeView[];
  onSelectDate?: (date: string) => void;
}) {
  const app = useApp();
  const toneSettings = app?.me?.settings;

  const todayIso = toJstDate(new Date());
  const [tY, tM] = todayIso.split('-').map(Number);

  const [currentYear, setCurrentYear] = useState(tY);
  const [currentMonth, setCurrentMonth] = useState(tM);

  const practicesByDate = groupPracticesByDate(practices);

  // 初期選択日（今日、または直近の予定日）
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    resolveInitialSelectedDate(currentYear, currentMonth, practicesByDate, todayIso),
  );

  const days = buildMonthDays(currentYear, currentMonth, todayIso);

  const handlePrevMonth = () => {
    const prev = getPrevMonth(currentYear, currentMonth);
    setCurrentYear(prev.year);
    setCurrentMonth(prev.month);
    setSelectedDate(resolveInitialSelectedDate(prev.year, prev.month, practicesByDate, todayIso));
  };

  const handleNextMonth = () => {
    const next = getNextMonth(currentYear, currentMonth);
    setCurrentYear(next.year);
    setCurrentMonth(next.month);
    setSelectedDate(resolveInitialSelectedDate(next.year, next.month, practicesByDate, todayIso));
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
    <div class="ios-calendar">
      {/* 1. 年月ヘッダー & ナビゲーション */}
      <div class="cal-nav-header">
        <span class="cal-year-month">{formatYearMonth(currentYear, currentMonth)}</span>
        <div class="cal-nav-controls">
          <button
            type="button"
            class="cal-nav-today-btn"
            onClick={handleToday}
            disabled={currentYear === tY && currentMonth === tM && selectedDate === todayIso}
          >
            今日
          </button>
          <div class="cal-nav-pager">
            <button
              type="button"
              class="cal-pager-btn"
              onClick={handlePrevMonth}
              aria-label="前月"
            >
              <Icon name="back" size={13} />
            </button>
            <button
              type="button"
              class="cal-pager-btn"
              onClick={handleNextMonth}
              aria-label="翌月"
            >
              <Icon name="chevron" size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. 曜日バー */}
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

      {/* 3. 月間グリッド */}
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
              aria-label={`${day.date}${
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
