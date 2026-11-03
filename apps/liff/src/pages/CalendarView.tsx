import { useState } from 'preact/hooks';
import { labelDate, toJstDate, yen, type PracticeView } from '@studio-attendance/shared';
import { CancelDeadlineBadge, Icon, StatusBadge, go, place } from '../ui';
import {
  buildMonthDays,
  formatYearMonth,
  getDayDotSummary,
  getNextMonth,
  getPrevMonth,
  groupPracticesByDate,
  resolveInitialSelectedDate,
  type CalendarDay,
} from './calendarLogic';
import { MyAnswerBadge } from './List';

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

export function CalendarPracticeItem({
  v,
  onClick,
}: {
  v: PracticeView;
  onClick: () => void;
}) {
  const p = v.practice;
  const isGoing = v.myAnswer === '行く';
  const isCanceled = p.status === '中止';

  return (
    <button
      type="button"
      class={`cal-practice-item ${isGoing ? 'is-going' : ''} ${isCanceled ? 'is-canceled' : ''}`}
      onClick={onClick}
    >
      <div class="cal-item-time-col">
        <span class="cal-item-start">{p.start}</span>
        <span class="cal-item-end">{p.end}</span>
      </div>
      <div class="cal-item-main">
        <div class="cal-item-title-row">
          <span class="cal-item-title">{place(p)}</span>
          <div class="cal-item-badges">
            {p.status !== '募集中' && <StatusBadge v={v} />}
            {p.status === '募集中' && <CancelDeadlineBadge date={p.date} studio={p.studio} />}
            <MyAnswerBadge answer={v.myAnswer} />
          </div>
        </div>
        <div class="cal-item-meta-row">
          <span>{v.goingCount}人参加</span>
          <span class="cal-meta-dot">·</span>
          <span>1人あたり {v.perPerson != null ? yen(v.perPerson) : '—'}</span>
          {v.bookerName && (
            <>
              <span class="cal-meta-dot">·</span>
              <span class="cal-meta-booker">{v.bookerName}</span>
            </>
          )}
        </div>
      </div>
      <div class="cal-item-arrow">
        <Icon name="chevron" size={14} />
      </div>
    </button>
  );
}

export function CalendarView({
  practices,
  tab,
}: {
  practices: PracticeView[];
  tab: 'all' | 'mine';
}) {
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
    // 月を切り替えたら、その月の最初の予約日（なければ1日）を選択
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
  };

  const handleSelectDay = (day: CalendarDay) => {
    setSelectedDate(day.date);
    if (!day.isCurrentMonth) {
      setCurrentYear(day.year);
      setCurrentMonth(day.month);
    }
  };

  // 選択日の予約情報
  const selectedPractices = practicesByDate.get(selectedDate) ?? [];
  const isSelectedToday = selectedDate === todayIso;

  return (
    <div class="ios-calendar">
      {/* 1. 年月ヘッダー & ナビゲーション */}
      <div class="cal-nav-header">
        <div class="cal-nav-title">
          <span class="cal-year-month">{formatYearMonth(currentYear, currentMonth)}</span>
        </div>
        <div class="cal-nav-actions">
          <button
            type="button"
            class="cal-today-btn"
            onClick={handleToday}
            disabled={currentYear === tY && currentMonth === tM && selectedDate === todayIso}
          >
            今日
          </button>
          <div class="cal-arrow-group">
            <button
              type="button"
              class="cal-arrow-btn"
              onClick={handlePrevMonth}
              aria-label="前月"
            >
              <Icon name="back" size={14} />
            </button>
            <button
              type="button"
              class="cal-arrow-btn"
              onClick={handleNextMonth}
              aria-label="翌月"
            >
              <Icon name="chevron" size={14} />
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
      <div class="cal-grid" role="grid">
        {days.map((day) => {
          const isSelected = day.date === selectedDate;
          const practicesOnDay = practicesByDate.get(day.date);
          const dots = getDayDotSummary(practicesOnDay);

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
              aria-label={`${day.date} ${dots.totalCount > 0 ? `${dots.totalCount}件の予約情報` : ''}`}
              aria-selected={isSelected}
            >
              <span class="cal-day-num">{day.day}</span>
              <div class="cal-dots-wrap">
                {dots.allCanceled ? (
                  <span class="cal-dot canceled" title="中止" />
                ) : (
                  <>
                    {dots.goingCount > 0 && <span class="cal-dot going" />}
                    {dots.otherCount > 0 && <span class="cal-dot other" />}
                    {dots.canceledCount > 0 && <span class="cal-dot canceled" title="中止" />}
                    {dots.totalCount > 2 && <span class="cal-dot more" />}
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* 4. 選択日の予約情報リスト（iOS スプリットビュー風） */}
      <section class="cal-selected-day-section">
        <div class="cal-selected-day-head">
          <div class="cal-selected-title-wrap">
            <h3 class="cal-selected-title">{labelDate(selectedDate)}</h3>
            {isSelectedToday && <span class="cal-today-badge">今日</span>}
          </div>
          <span class="cal-selected-count">
            {selectedPractices.length > 0 ? `${selectedPractices.length}件` : ''}
          </span>
        </div>

        {selectedPractices.length === 0 ? (
          <div class="cal-empty-day">
            <span>
              {tab === 'mine'
                ? 'この日に行く予約情報はありません。'
                : 'この日の予約情報はありません。'}
            </span>
          </div>
        ) : (
          <div class="cal-practice-list">
            {selectedPractices.map((v) => (
              <CalendarPracticeItem
                key={v.practice.id}
                v={v}
                onClick={() => go(`/p/${encodeURIComponent(v.practice.id)}`)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
