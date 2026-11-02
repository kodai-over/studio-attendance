import { useEffect, useRef, useState } from 'preact/hooks';
import { computeCancelDeadline, endAfterStart, labelDate, roomInfo, yen, type Answer, type AttendeeView, type PracticePatch, type PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { RoomSelect } from '../components/StudioRoom';
import { openCalendar, prefersIcs, shareLink } from '../liff';
import { Avatar, DeleteConfirmDialog, FRESH_MS, Icon, Pass, RsvpButtons, Spinner, Syncing, TopBar, shareData, useApp, useRunner } from '../ui';
import { isAnswering } from '../answering';
import { useAnswer } from './List';

/**
 * 一覧にある内容ですぐ表示し、最新の内容は裏で取り直す（取り直している間もボタンは押せる）。
 * 一覧を取ったばかり（FRESH_MS 以内）なら取り直さない。取り直した・操作した結果は一覧に入れ、画面は一覧に合わせる
 * （一覧に無い練習だけ手元の内容を出す）。回答を送っている途中は、取り直した結果で押した回答を戻さない
 */
export function usePractice(id: string) {
  const { toast, practices, practicesAt, updatePractice } = useApp();
  const inList = practices?.find((x) => x.practice.id === id) ?? null;
  const fresh = () => inList != null && practicesAt > 0 && Date.now() - practicesAt < FRESH_MS;
  // 取り直した・操作した結果。一覧に無い練習のときだけ使う
  const [own, setV] = useState<PracticeView | null>(null);
  const v = inList ?? own;
  const latest = useRef(inList);
  latest.current = inList;
  const [loading, setLoading] = useState(() => !fresh());
  const [run, busy] = useRunner();

  useEffect(() => {
    setV(null);
    if (fresh()) return setLoading(false);
    setLoading(true);
    const started = Date.now();
    api('getPractice', { id })
      .then((r) => {
        // 取り直している間に回答を押していれば、押す前に読んだかもしれないので使わない（結果は回答の処理が入れる）
        if (isAnswering(id, started)) return;
        setV(r);
        updatePractice(r);
      })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), true))
      .finally(() => setLoading(false));
  }, [id]);

  const update = async (fn: () => Promise<PracticeView>, done?: string) => {
    const r = await run(fn, done);
    if (r) {
      // 回答を送っている途中なら、押した回答はそのまま出す（人数などは回答の結果で差し替わる）
      const cur = latest.current;
      const next = isAnswering(id) && cur ? { ...r, myAnswer: cur.myAnswer } : r;
      setV(next);
      updatePractice(next); // 一覧にもすぐ反映する
    }
    return r;
  };
  return { v, inList, loading, run, busy, update };
}

/** 練習のパス。日時・場所・金額・人数 */
export function PracticePass({ v }: { v: PracticeView }) {
  const { me } = useApp();
  const p = v.practice;
  const deadline = computeCancelDeadline(p.date, p.studio, me?.settings?.cancelRules ?? []);
  return (
    <Pass
      date={p.date}
      status={p.status}
      fields={[
        { label: '時間', value: `${p.start}–${p.end}`, wide: true },
        { label: 'スタジオ', value: p.studio, jp: true, wide: !p.room },
        ...(p.room ? [{ label: '部屋', value: p.room, note: roomInfo(me.settings.studios, p.studio, p.room), jp: true }] : []),
        ...(deadline
          ? [
              {
                label: 'キャンセル期限',
                value: (
                  <span class={`deadline-text${deadline.isSoon ? ' is-soon' : ''}${deadline.isPast ? ' is-past' : ''}`}>
                    {deadline.isPast ? 'キャンセル期限超過' : deadline.formatted}
                  </span>
                ),
                jp: true,
                wide: true,
              },
            ]
          : []),
        { label: '1人あたり', value: v.perPerson != null ? yen(v.perPerson) : '—', note: p.feeOverride ? '調整済み' : null },
        { label: 'スタジオ代', value: yen(p.fee) },
        { label: '参加人数', value: <>{v.goingCount}{p.max ? <small class="of">/{p.max}</small> : null} {p.status === '満員' && <span class="badge-full">FULL</span>}</>, note: p.min ? `最低人数 ${p.min}人` : null },
        { label: '予約者', value: v.bookerName, jp: true },
        ...(p.memo ? [{ label: 'メモ', value: p.memo, jp: true, wide: true }] : []),
      ]}
    />
  );
}

/** 「予定」から開く練習の画面。見るのと出欠・カレンダーだけ（編集・削除・募集は「募集」から） */
export function DetailPage({ id, focus }: { id: string; focus: 'calendar' | null }) {
  const { v, inList, loading, busy, update } = usePractice(id);
  const { answer } = useAnswer();
  const { toast } = useApp();
  const calRef = useRef<HTMLDivElement>(null);
  const going = v ? v.myAnswer === '行く' && v.practice.status !== '中止' : false;

  useEffect(() => {
    if (v && focus === 'calendar') calRef.current?.scrollIntoView({ behavior: 'smooth', block: going ? 'nearest' : 'start' });
  }, [v != null, focus, going]);

  if (!v) return <><TopBar back />{loading ? <Spinner /> : <div class="empty">予約情報が見つかりません</div>}</>;
  const p = v.practice;
  // 行くと答えたら、カレンダーに追加をボタンのすぐ下に出す（答えてそのまま追加できるように）
  const calendar = <CalendarButtons v={v} highlight={going} compact={going} />;

  return (
    <>
      <TopBar back>
        {loading && <Syncing />}
        {v.joinUrl && (
          <button
            class="icon-btn"
            style={{ marginLeft: 'auto' }}
            aria-label="参加リンクを共有"
            onClick={async () => {
              if ((await shareLink(shareData(v, v.joinUrl!))) === 'copied') toast('参加リンクをコピーしました');
            }}
          >
            <Icon name="share" size={20} />
          </button>
        )}
      </TopBar>

      <div class="detail-layout">
        <div class="detail-primary">
          <PracticePass v={v} />

          <RsvpButtons
            solo
            value={v.myAnswer}
            status={p.status}
            busy={busy && !inList}
            onAnswer={(a: Answer) => {
              // 一覧にある練習は、待たずに切り替える（結果は一覧に入り、この画面もそれに合わせる）
              if (inList) answer(id, a);
              else update(() => api('rsvp', { id, answer: a }));
            }}
          />

          {going && (
            <div ref={calRef} class="cal-inline">
              {calendar}
            </div>
          )}
        </div>

        <div class="detail-side">
          <Attendees v={v} onRemove={(a) => update(() => api('removeAttendance', { id, participant: a.participant }), '削除しました')} />
        </div>

        <div class="detail-extra">
          {!going && (
            <>
              <div class="sec-head" ref={calRef}>
                <Icon name="calendar" size={18} />
                カレンダーに追加
              </div>
              {calendar}
            </>
          )}

          {/* 古いお知らせのリンクなどから開いた予約者が、直す・消す場所に迷わないように */}
          {v.canEdit && (
            <p class="note" style={{ marginTop: 16 }}>
              編集・削除は{' '}
              <a href={`#/recruit/${encodeURIComponent(p.id)}`}>「募集」のこの予約情報</a>
              から
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/** カレンダーに追加。iPhone・Mac なら iPhone のカレンダーを、それ以外なら Google を大きく出す */
function CalendarButtons({ v, highlight, compact = false }: { v: PracticeView; highlight: boolean; compact?: boolean }) {
  const ics = { label: 'iPhone', open: () => openCalendar(v.icsUrl, 'ics') };
  const google = { label: 'Google', open: () => openCalendar(v.googleCalendarUrl, 'google') };
  const [first, second] = prefersIcs() ? [ics, google] : [google, ics];
  return (
    <div class={`grid2${compact ? ' compact' : ''}`}>
      <button class={`btn ${compact ? 'small ' : ''}${highlight ? 'primary' : 'ghost'}`} onClick={first.open}>
        <Icon name="calendar" size={compact ? 13 : 16} />
        {first.label}
      </button>
      <button class={`btn ${compact ? 'small ' : ''}ghost`} onClick={second.open}>
        {second.label}
      </button>
    </div>
  );
}

/** 参加メンバーの一覧。行く・保留・行かないの順に名前を出す。自分が足したゲスト（予約者と管理者はすべてのゲスト）は取り消せる */
function Attendees({ v, onRemove }: { v: PracticeView; onRemove: (a: AttendeeView) => void }) {
  const groups = [
    { key: 'going' as const, mark: '○', label: '行く', people: v.going },
    { key: 'maybe' as const, mark: '△', label: '未定', people: v.maybe },
    { key: 'notGoing' as const, mark: '✕', label: '行かない', people: v.notGoing },
  ];
  const total = v.going.length + v.maybe.length + v.notGoing.length;

  return (
    <div class="attendees-section">
      <div class="sec-head">
        <Icon name="people" size={18} />
        参加者
        <span class="n">{total}</span>
      </div>
      {groups.map(({ key, mark, label, people }) =>
        people.length === 0 ? null : (
          <div key={key} class={`attendee-group status-${key}`}>
            <div class="attendee-head">
              <span class="attendee-mark" aria-hidden="true">
                {mark}
              </span>
              <span class="attendee-label">{label}</span>
              <span class="attendee-count">{people.length}</span>
            </div>
            <div class={`people${key === 'notGoing' ? ' dim' : ''}`}>
              {people.map((a) => (
                <span class="person" key={a.participant}>
                  <Avatar name={a.name} guest={a.kind === 'ゲスト'} />
                  <span>{a.name}</span>
                  {a.kind === 'ゲスト' && a.canRemove && (
                    <button class="x" aria-label={`${a.name}さんを削除`} onClick={() => confirm(`${a.name}さんを削除しますか？`) && onRemove(a)}>
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        ),
      )}
      {total === 0 && <div class="muted">まだ誰も回答していません</div>}
    </div>
  );
}

/** 練習を削除する前の確認の文。答えている人がいれば人数も添える */
export function deleteMessage(v: PracticeView): string {
  const p = v.practice;
  const answered = v.goingCount + v.maybe.length;
  return [
    `${labelDate(p.date)} ${p.start}〜 ${p.studio}${p.room ? ' ' + p.room : ''} を削除しますか？`,
    answered > 0 ? `回答している人がいます（行く${v.goingCount}人・未定${v.maybe.length}人）。回答も削除されます。` : '回答も削除されます。',
    'グループへの連絡は送られないので、必要ならグループで伝えてください。',
  ].join('\n');
}

/** 練習の編集（予約者と管理者）。「募集」の練習の画面に出す */
export function EditForm({
  v,
  onSave,
  onDelete,
  busy,
}: {
  v: PracticeView;
  onSave: (p: PracticePatch) => Promise<unknown>;
  onDelete: (notifyGroups: boolean) => Promise<unknown> | void;
  busy: boolean;
}) {
  const { me } = useApp();
  const p = v.practice;
  const [confirming, setConfirming] = useState(false);
  const [f, setF] = useState({
    start: p.start,
    end: p.end,
    room: p.room,
    fee: String(p.fee),
    max: p.max ? String(p.max) : '',
    min: p.min ? String(p.min) : '',
    feeOverride: p.feeOverride ? String(p.feeOverride) : '',
    memo: p.memo,
  });
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value });
  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  return (
    <>
      <details class="menu edit">
        <summary class="menu-row">
          <Icon name="edit" size={20} />
          <span class="grow">編集</span>
          <Icon name="chevron" size={18} />
        </summary>
        <section class="card" style={{ margin: 0, borderRadius: 0 }}>
          <div class="grid2">
            <label class="field">
              <span>開始</span>
              <input type="time" value={f.start} onInput={(e) => setF({ ...f, start: e.currentTarget.value, end: endAfterStart(e.currentTarget.value, f.end) })} />
            </label>
            <label class="field">
              <span>終了</span>
              <input type="time" value={f.end} onInput={set('end')} />
            </label>
          </div>
          <div class="grid2">
            <div class="field">
              <span>部屋</span>
              <RoomSelect studios={me.settings.studios} studio={p.studio} value={f.room} onChange={(room) => setF({ ...f, room })} />
            </div>
            <label class="field">
              <span>スタジオ代 ¥</span>
              <input type="number" inputMode="numeric" value={f.fee} onInput={set('fee')} />
            </label>
          </div>
          <div class="grid3">
            <label class="field">
              <span>上限人数</span>
              <input type="number" inputMode="numeric" placeholder="なし" value={f.max} onInput={set('max')} />
            </label>
            <label class="field">
              <span>最低人数</span>
              <input type="number" inputMode="numeric" placeholder={`標準 ${me.settings.minDefault}人`} value={f.min} onInput={set('min')} />
            </label>
            <label class="field">
              <span>1人あたり ¥</span>
              <input type="number" inputMode="numeric" placeholder="自動" value={f.feeOverride} onInput={set('feeOverride')} />
            </label>
          </div>
          <label class="field">
            <span>メモ</span>
            <textarea rows={3} value={f.memo} onInput={set('memo')} />
          </label>
          <button
            class="btn primary block"
            disabled={busy}
            onClick={() =>
              onSave({ start: f.start, end: f.end, room: f.room, fee: Number(f.fee) || 0, max: num(f.max), min: num(f.min), feeOverride: num(f.feeOverride), memo: f.memo })
            }
          >
            保存
          </button>
          <button
            class="btn danger block"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            削除する
          </button>
        </section>
      </details>

      <DeleteConfirmDialog
        view={confirming ? v : null}
        onClose={() => setConfirming(false)}
        onConfirm={async (notifyGroups) => {
          setConfirming(false);
          await onDelete(notifyGroups);
        }}
        busy={busy}
      />
    </>
  );
}
