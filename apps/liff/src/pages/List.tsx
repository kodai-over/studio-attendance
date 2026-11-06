import { useEffect, useState } from 'preact/hooks';
import { isMinePractice, labelDate, toJstDate, type Answer, type PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { CancelDeadlineBadge, FRESH_MS, Fee, Icon, RsvpButtons, Spinner, StatusBadge, Stub, Syncing, Tabs, TopBar, go, place, useApp, useHideOnScroll, useRunner } from '../ui';
import { CalendarView } from './CalendarView';
import {
  filterByDayKind,
  groupByMonthWeek,
  readDayKind,
  readScheduleViewMode,
  saveDayKind,
  saveScheduleViewMode,
  type DayKind,
  type MonthGroup,
  type ScheduleViewMode,
} from './calendarLogic';

type Tab = 'all' | 'mine';
const TAB_KEY = 'pb:tab';

export function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === 'mine' ? t : 'all';
  } catch {
    return 'all';
  }
}

/** 自分の回答（○ △ ✕ の記号） */
export function MyAnswerBadge({ answer }: { answer: Answer | null }) {
  if (answer === '行く') return <span class="my-answer going" title="行く" aria-label="行く">○</span>;
  if (answer === '保留') return <span class="my-answer maybe" title="未定" aria-label="未定">△</span>;
  if (answer === '行かない') return <span class="my-answer not-going" title="行かない" aria-label="行かない">✕</span>;
  return <span class="my-answer none" title="未回答" aria-label="未回答">—</span>;
}

export function ListPage({ initialTab }: { initialTab?: string | null }) {
  const { me, practices: list, practicesAt, setPractices } = useApp();
  const [tab, setTab] = useState<Tab>(() => (initialTab === 'mine' || initialTab === 'all' ? initialTab : readTab()));
  const [dayKind, setDayKind] = useState<DayKind>(() => readDayKind());
  const [showFilter, setShowFilter] = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ScheduleViewMode>(() => readScheduleViewMode());
  const [run, busy] = useRunner();
  // 下にスクロールしている間は、カレンダーを1週間分に縮めてチケットを広く見せる
  const collapsed = useHideOnScroll();

  useEffect(() => {
    // 起動時のまとめ取得から時間がたっていれば取り直す（前回の表示のときは起動処理が取り直すので待つ）
    if (practicesAt > 0 && Date.now() - practicesAt > FRESH_MS) run(() => api('listPractices')).then((r) => r && setPractices(r, false));
  }, []);

  const selectTab = (t: Tab) => {
    setTab(t);
    setSelectedDate(null);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* 保存できなくても動く */
    }
  };

  const selectDayKind = (kind: DayKind) => {
    setDayKind(kind);
    saveDayKind(kind);
    setSelectedDate(null);
  };

  const toggleCollapse = (key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const showCalendar = viewMode === 'calendar';

  const handleToggleCalendar = () => {
    const next: ScheduleViewMode = showCalendar ? 'list' : 'calendar';
    setViewMode(next);
    saveScheduleViewMode(next);
    if (next === 'list') {
      setSelectedDate(null);
    }
  };

  // 「予定」に出すのは、自分に招待が来た（入っているグループに募集された）練習と、自分が招待を送った（登録した）練習。
  // 答えた・ゲストを足した練習も出す。管理者でも、ほかの練習は「募集」で見る
  const mine = (list ?? []).filter((v) => isMinePractice(v, me.member.userId, me.member.groups));
  const active = mine.filter((v) => v.practice.status !== '中止');
  const groups: Record<Tab, PracticeView[]> = {
    all: mine,
    mine: active.filter((v) => v.myAnswer === '行く'),
  };
  const baseList = groups[tab];

  // 曜日フィルターで絞り込まれた予約情報（カレンダーにも同じ絞り込みを反映）
  const filteredList = filterByDayKind(baseList, dayKind);

  // 日付選択時はその日のみ表示、非選択時は filteredList
  const displayList = selectedDate
    ? baseList.filter((v) => v.practice.date === selectedDate)
    : filteredList;

  // 月・週グループ
  const monthGroups: MonthGroup[] = !selectedDate ? groupByMonthWeek(displayList) : [];

  return (
    <>
      <TopBar title="予定">
        {(practicesAt === 0 || busy) && <Syncing />}
        <button
          type="button"
          class={`icon-btn${dayKind !== 'all' ? ' is-filtered' : ''}`}
          onClick={() => setShowFilter(!showFilter)}
          aria-pressed={showFilter}
          aria-label={showFilter ? 'フィルターを閉じる' : '曜日で絞り込み'}
        >
          <Icon name="filter" />
        </button>
        <button
          type="button"
          class="icon-btn"
          onClick={handleToggleCalendar}
          aria-pressed={showCalendar}
          aria-label={showCalendar ? 'カレンダーを閉じる' : 'カレンダーを開く'}
        >
          <Icon name={showCalendar ? 'x' : 'calendar'} />
        </button>
      </TopBar>

      <div class="schedule-head">
        <div class="tabs-head">
          <Tabs
            value={tab}
            onChange={selectTab}
            items={[
              { key: 'all', label: 'すべて', count: list ? groups.all.length : undefined },
              { key: 'mine', label: '行く', count: list ? groups.mine.length : undefined },
            ]}
          />
        </div>

        {/* 格納型曜日フィルター */}
        <div class="filter-fold" aria-hidden={!showFilter} data-open={showFilter}>
          <div class="filter-fold-inner">
            <div class="filter-chips" role="radiogroup" aria-label="曜日フィルター">
              <button
                type="button"
                class={`filter-chip${dayKind === 'weekday' ? ' active' : ''}`}
                aria-pressed={dayKind === 'weekday'}
                onClick={() => selectDayKind(dayKind === 'weekday' ? 'all' : 'weekday')}
              >
                平日のみ
              </button>
              <button
                type="button"
                class={`filter-chip${dayKind === 'holiday' ? ' active' : ''}`}
                aria-pressed={dayKind === 'holiday'}
                onClick={() => selectDayKind(dayKind === 'holiday' ? 'all' : 'holiday')}
              >
                休日のみ
              </button>
              {dayKind !== 'all' && (
                <button
                  type="button"
                  class="btn plain small"
                  onClick={() => selectDayKind('all')}
                >
                  解除
                </button>
              )}
            </div>
          </div>
        </div>

        {/* フィルター格納中に適用されている絞り込みタグ */}
        {!showFilter && dayKind !== 'all' && (
          <div class="active-filter-tags">
            <span class="filter-tag">
              {dayKind === 'weekday' ? '平日のみ' : '休日のみ'}
              <button
                type="button"
                class="tag-x"
                onClick={() => selectDayKind('all')}
                aria-label="絞り込みを解除"
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          </div>
        )}

        {showCalendar && (
          <CalendarView
            practices={filteredList}
            selectedDate={selectedDate}
            onSelectDate={(d) => setSelectedDate(d)}
            compact={collapsed}
          />
        )}
      </div>

      {list == null ? (
        <Spinner />
      ) : selectedDate ? (
        <>
          <div class="selected-date-banner">
            <span>{labelDate(selectedDate)} を表示中</span>
            <button
              type="button"
              class="clear-btn"
              onClick={() => setSelectedDate(null)}
              aria-label="日付選択を解除"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          {displayList.length === 0 ? (
            <div class="empty">
              <div>この日の予約情報はありません</div>
            </div>
          ) : (
            <div class="ticket-grid">
              {displayList.map((v) => (
                <PracticeCard key={v.practice.id} v={v} />
              ))}
            </div>
          )}
        </>
      ) : displayList.length === 0 ? (
        <div class="empty">
          <div>{tab === 'mine' ? '行く予約情報はありません' : '予約情報はまだありません'}</div>
          {tab === 'all' && <p class="note">グループの予約情報が出ないときは、そのグループの募集カードの「回答」から一度開いてください</p>}
        </div>
      ) : (
        <>
          {monthGroups.map((m) => {
            const mKey = `month:${m.month}`;
            const isMOpen = !collapsedKeys.has(mKey);
            return (
              <section key={m.month} class="schedule-group">
                <button
                  type="button"
                  class="schedule-group-head month"
                  onClick={() => toggleCollapse(mKey)}
                  data-open={isMOpen}
                  aria-expanded={isMOpen}
                >
                  <span class="chevron-icon">
                    <Icon name="chevron" size={16} />
                  </span>
                  <span>{m.label}</span>
                  <span class="group-count">{m.totalCount}件</span>
                </button>
                <div class="schedule-group-body" data-open={isMOpen}>
                  {m.weeks.map((w) => {
                    const wKey = `week:${w.start}`;
                    const isWOpen = !collapsedKeys.has(wKey);
                    return (
                      <div key={w.start} class="schedule-subgroup">
                        <button
                          type="button"
                          class="schedule-group-head week"
                          onClick={() => toggleCollapse(wKey)}
                          data-open={isWOpen}
                          aria-expanded={isWOpen}
                        >
                          <span class="chevron-icon">
                            <Icon name="chevron" size={14} />
                          </span>
                          <span>{w.label}</span>
                          <span class="group-count">{w.items.length}件</span>
                        </button>
                        <div class="schedule-group-body" data-open={isWOpen}>
                          <div class="ticket-grid">
                            {w.items.map((v) => (
                              <PracticeCard key={v.practice.id} v={v} />
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          <p class="note center section">回答は下のメニューの「回答」からできます</p>
        </>
      )}
    </>
  );
}

/** チケットの下の段。予約者とキャンセル期限 */
export function TicketSub({ booker, date, studio }: { booker?: string | null; date: string; studio: string }) {
  return (
    <div class="ticket-sub">
      {booker && (
        <span class="meta-item" title={`予約者: ${booker}`}>
          <Icon name="user" size={13} />
          {booker}
        </span>
      )}
      <CancelDeadlineBadge date={date} studio={studio} />
    </div>
  );
}

/**
 * 押した瞬間の見た目。記号・行く人数・満員かどうかを先に変える
 * （名前の並びと1人あたりはサーバーの結果で差し替える）
 */
export function PracticeCard({
  v,
  onAnswer,
  onClear,
  busy,
  highlighted,
}: {
  v: PracticeView;
  onAnswer?: (a: Answer) => void;
  onClear?: () => void;
  busy?: boolean;
  highlighted?: boolean;
}) {
  const { toast } = useApp();
  const p = v.practice;
  const open = () => go(`/p/${encodeURIComponent(p.id)}`);

  const handleBlocked = (reason: 'full' | 'closed') => {
    if (reason === 'full') toast('満員のため「行く」は選べません', true);
  };

  return (
    <article
      class={`ticket${highlighted ? ' is-cal-highlighted' : ''}`}
      data-answer={v.myAnswer ?? 'none'}
      data-status={p.status}
      data-ticket-date={p.date}
    >
      <Stub date={p.date} onClick={open} />
      <button class="ticket-main" onClick={open}>
        <span class="sr">{labelDate(p.date)}</span>
        <div class="time">
          <span>
            {p.start}–{p.end}
          </span>
          <StatusBadge v={v} />
          {!onAnswer && <MyAnswerBadge answer={v.myAnswer} />}
        </div>
        <div class="place">{place(p)}</div>
        <div class="ticket-meta">
          <span class="meta-item" aria-label={`行く ${v.goingCount}人`}>
            <Icon name="people" size={16} />
            {v.goingCount}
            {p.max ? `/${p.max}` : ''}
          </span>
          <Fee v={v} />
        </div>
        <TicketSub booker={v.bookerName} date={p.date} studio={p.studio} />
      </button>
      {onAnswer && <RsvpButtons value={v.myAnswer} status={p.status} busy={busy} onAnswer={onAnswer} onClear={onClear} onBlocked={handleBlocked} />}
    </article>
  );
}
