import { useEffect, useState } from 'preact/hooks';
import { isMinePractice, labelDate, type Answer, type PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { AvatarStack, CancelDeadlineBadge, FRESH_MS, Fee, Icon, RsvpButtons, Spinner, StatusBadge, Stub, Syncing, Tabs, go, place, useApp, useRunner } from '../ui';

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

/** 自分の回答状況を示すバッジ（シンプルな記号表示） */
export function MyAnswerBadge({ answer }: { answer: Answer | null }) {
  if (answer === '行く') return <span class="my-answer-badge going" title="行く" aria-label="行く">○</span>;
  if (answer === '保留') return <span class="my-answer-badge maybe" title="未定" aria-label="未定">△</span>;
  if (answer === '行かない') return <span class="my-answer-badge not-going" title="行かない" aria-label="行かない">✕</span>;
  return <span class="my-answer-badge none" title="未回答" aria-label="未回答">—</span>;
}

export function ListPage({ initialTab }: { initialTab?: string | null }) {
  const { me, practices: list, practicesAt, setPractices } = useApp();
  const [tab, setTab] = useState<Tab>(() => (initialTab === 'mine' || initialTab === 'all' ? initialTab : readTab()));
  const [run, busy] = useRunner();

  useEffect(() => {
    // 起動時のまとめ取得から時間がたっていれば取り直す（前回の表示のときは起動処理が取り直すので待つ）
    if (practicesAt > 0 && Date.now() - practicesAt > FRESH_MS) run(() => api('listPractices')).then((r) => r && setPractices(r, false));
  }, []);

  const selectTab = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* 保存できなくても動く */
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
  const shown = groups[tab];

  return (
    <>
      <header class="tabs-head">
        <Tabs
          value={tab}
          onChange={selectTab}
          items={[
            { key: 'all', label: 'すべて', count: list ? groups.all.length : undefined },
            { key: 'mine', label: '行く', count: list ? groups.mine.length : undefined },
          ]}
        />
        {(practicesAt === 0 || busy) && <Syncing />}
      </header>

      {list == null ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <div class="empty">
          <div>{tab === 'mine' ? '行く予約情報はありません。' : '登録されている予約情報はありません。'}</div>
          {tab === 'all' && <p class="note">所属グループの予約情報が出ないときは、そのグループの募集メッセージの「回答」から一度開いてください</p>}
          {tab === 'all' && <p class="note">スタジオの予約は「募集」の右上の＋から登録できます</p>}
        </div>
      ) : (
        <>
          <div class="ticket-grid">
            {shown.map((v) => (
              <PracticeCard key={v.practice.id} v={v} />
            ))}
          </div>
          <p class="note list-rsvp-note">
            ※回答や変更は、メニューの「RSVP」からまとめて行えます
          </p>
        </>
      )}
    </>
  );
}

/**
 * 押した瞬間の見た目。記号・行く人数・満員かどうかを先に変える
 * （名前の並びと1人あたりはサーバーの結果で差し替える）
 */
export function PracticeCard({
  v,
  onAnswer,
  busy,
}: {
  v: PracticeView;
  onAnswer?: (a: Answer) => void;
  busy?: boolean;
}) {
  const { toast } = useApp();
  const [shaking, setShaking] = useState(false);
  const p = v.practice;
  const open = () => go(`/p/${encodeURIComponent(p.id)}`);

  const handleBlocked = (reason: 'full' | 'closed') => {
    if (reason === 'full') {
      setShaking(true);
      toast('満員のため「○ 行く」は選べません（未定または行かないを選択できます）', true);
      setTimeout(() => setShaking(false), 450);
    }
  };

  return (
    <article class={`ticket${shaking ? ' is-shaking' : ''}`} data-answer={v.myAnswer ?? 'none'} data-status={p.status}>
      <Stub date={p.date} onClick={open} />
      <button class="ticket-main" onClick={open}>
        <span class="sr">{labelDate(p.date)}</span>
        <div class="time">
          {p.start}–{p.end}
          <StatusBadge v={v} />
          {v.bookerName && (
            <span class="booker" title={`予約者: ${v.bookerName}`}>
              <Icon name="user" size={11} />
              <span>{v.bookerName}</span>
            </span>
          )}
        </div>
        <div class="place">{place(p)}</div>
        <CancelDeadlineBadge date={p.date} studio={p.studio} />
        <div class="ticket-foot">
          <AvatarStack names={v.going.map((a) => ({ name: a.name, guest: a.kind === 'ゲスト' }))} />
          <span class="count">
            <Icon name="people" size={14} />
            {v.goingCount}
            {p.max ? <small>/{p.max}</small> : null}
            {p.status === '満員' && <span class="badge-full">FULL</span>}
          </span>
          <Fee v={v} />
          <MyAnswerBadge answer={v.myAnswer} />
        </div>
      </button>
      {onAnswer && (
        <RsvpButtons
          value={v.myAnswer}
          status={p.status}
          busy={busy}
          onAnswer={onAnswer}
          onBlocked={handleBlocked}
        />
      )}
    </article>
  );
}
