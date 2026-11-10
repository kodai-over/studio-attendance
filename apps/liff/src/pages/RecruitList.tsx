import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { isAdmin, labelDate, toJstDate, type PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { MyAnswerBadge, TicketSub } from './List';
import { DeleteConfirmDialog, Fee, Icon, Spinner, StatusBadge, Stub, Tabs, TopBar, go, place, useApp, useRunner } from '../ui';
import { canPickForRemind, defaultRemindTargets, filterAvailableGroups, filterRecruitPractices, readRecruitScope, saveRecruitScope, type RecruitScope } from './recruitLogic';

/**
 * 「募集」。自分が登録した練習（管理者はすべての練習）を並べ、押すと募集・編集の画面へ。
 * 左にスワイプすると削除が出る。右上の＋から登録する
 */
export function RecruitListPage() {
  const { me, practices, setPractices, deletePractice } = useApp();
  const [run, busy] = useRunner();
  const [fresh, setFresh] = useState(false);
  // 削除ボタンを出しているチケット（一度に1枚だけ）
  const [opened, setOpened] = useState<string | null>(null);
  // 削除確認ダイアログを出している予約情報
  const [deletingTarget, setDeletingTarget] = useState<PracticeView | null>(null);
  // 「選ぶ」でまとめて募集を送る予約情報
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  // 募集を送るグループを選ぶダイアログ
  const [choosing, setChoosing] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);

  // 手元の一覧ですぐ表示し、最新の一覧は裏で取り直す
  useEffect(() => {
    run(() => api('listPractices')).then((r) => {
      if (r) setPractices(r, true);
      setFresh(true);
    });
  }, []);

  const admin = isAdmin(me.member);
  const [scope, setScope] = useState<RecruitScope>(() => readRecruitScope());

  const selectScope = (s: string) => {
    const next = s === 'all' ? 'all' : 'mine';
    setScope(next);
    saveRecruitScope(next);
  };

  const rawPractices = practices == null && !fresh ? null : practices;
  const { mine, all, shown: list } = filterRecruitPractices(rawPractices, admin, me.member.userId, scope);

  const today = toJstDate(new Date());
  const pickable = (list ?? []).filter((v) => canPickForRemind(v, today));
  const stopSelecting = () => {
    setSelecting(false);
    setPicked([]);
  };
  const togglePick = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  // 送り先に選べるのは、自分とBotが入っているグループすべて
  const myGroups = filterAvailableGroups(me.groups, me.member.groups);
  const pickedViews = pickable.filter((v) => picked.includes(v.practice.id));
  const chooseTargets = () => {
    setTargets(defaultRemindTargets(pickedViews, myGroups));
    setChoosing(true);
  };
  const remindPicked = async () => {
    if (pickedViews.length === 0 || targets.length === 0) return;
    const sent = await run(() => api('remindPractices', { ids: pickedViews.map((v) => v.practice.id), groups: targets }), '募集を送りました');
    setChoosing(false);
    if (sent) stopSelecting();
  };

  const remove = (v: PracticeView) => {
    setOpened(null);
    setDeletingTarget(v);
  };

  return (
    <>
      <TopBar title="募集">
        {/* 登録の＋と、募集を送る予約情報を選ぶ操作を、同じアイコンボタンで並べる */}
        {(pickable.length > 0 || selecting) && (
          <button
            class="icon-btn"
            aria-label={selecting ? '選ぶのをやめる' : '募集を送る予約情報を選ぶ'}
            aria-pressed={selecting}
            onClick={() => {
              setOpened(null);
              if (selecting) stopSelecting();
              else setSelecting(true);
            }}
          >
            <Icon name={selecting ? 'x' : 'send'} />
          </button>
        )}
        <button class="icon-btn" aria-label="スタジオ予約を登録" onClick={() => (opened ? setOpened(null) : go('/register'))}>
          <Icon name="plus" />
        </button>
      </TopBar>
      {admin && (
        <div class="tabs-head section">
          <Tabs
            value={scope}
            onChange={selectScope}
            items={[
              { key: 'mine', label: '自分', count: mine.length },
              { key: 'all', label: 'すべて', count: all.length },
            ]}
          />
        </div>
      )}
      {list == null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <div class="empty">
          <div>{admin && scope === 'mine' && all.length > 0 ? '自分が登録した予約情報はありません' : '予約情報はまだありません'}</div>
          {admin && scope === 'mine' && all.length > 0 && (
            <p class="note">他の人が登録した予約情報は「すべて」で見られます</p>
          )}
          <button class="btn primary" onClick={() => go('/register')}>
            <Icon name="plus" size={18} />
            スタジオ予約を登録
          </button>
        </div>
      ) : (
        <div class={`ticket-grid${selecting ? ' picking' : ''}`}>
          {list.map((v) =>
            selecting ? (
              <PickRow key={v.practice.id} v={v} enabled={canPickForRemind(v, today)} on={picked.includes(v.practice.id)} onToggle={() => togglePick(v.practice.id)} />
            ) : (
              <SwipeRow
                key={v.practice.id}
                open={opened === v.practice.id}
                anyOpen={opened != null}
                onOpen={(o) => setOpened(o ? v.practice.id : null)}
                onDelete={() => remove(v)}
              >
                <RecruitTicket v={v} />
              </SwipeRow>
            ),
          )}
        </div>
      )}

      {selecting && (
        <div class="pick-bar">
          <button class="btn primary block" disabled={busy || picked.length === 0} onClick={chooseTargets}>
            <Icon name="send" size={18} />
            {picked.length > 0 ? `${picked.length}件の募集を送る` : '募集を送る予約情報を選ぶ'}
          </button>
        </div>
      )}

      {choosing && (
        <div class="overlay" role="dialog" aria-modal="true" aria-label="募集を送るグループ">
          <div class="dialog">
            <h3>募集を送る</h3>
            <p class="muted">{pickedViews.length}件の予約情報を、選んだグループに送ります</p>
            {myGroups.length === 0 ? (
              <p class="note">Botをグループに招待すると送れます</p>
            ) : (
              <div class="chips">
                {myGroups.map((g) => (
                  <button
                    key={g.id}
                    class="chip"
                    aria-pressed={targets.includes(g.id)}
                    onClick={() => setTargets((cur) => (cur.includes(g.id) ? cur.filter((x) => x !== g.id) : [...cur, g.id]))}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            )}
            <div class="btn-row">
              <button class="btn" disabled={busy} onClick={() => setChoosing(false)}>
                キャンセル
              </button>
              <button class="btn primary" disabled={busy || targets.length === 0} onClick={remindPicked}>
                {targets.length > 0 ? `${targets.length}グループに送る` : '送る'}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmDialog
        view={deletingTarget}
        onClose={() => setDeletingTarget(null)}
        onConfirm={async (notifyGroups) => {
          const target = deletingTarget;
          setDeletingTarget(null);
          if (target) await deletePractice(target, { notifyGroups });
        }}
      />
    </>
  );
}

/** 「選ぶ」の間のチケット。押すと選ぶ／外す。募集を送れないもの（満員・未募集など）は薄くして選べない */
function PickRow({ v, enabled, on, onToggle }: { v: PracticeView; enabled: boolean; on: boolean; onToggle: () => void }) {
  return (
    <button class={`pick-row${on ? ' on' : ''}`} role="checkbox" aria-checked={on} aria-disabled={!enabled} disabled={!enabled} onClick={onToggle}>
      <RecruitTicket v={v} />
      <span class="pick-mark" aria-hidden="true">
        {on && <Icon name="check" size={16} />}
      </span>
    </button>
  );
}

function RecruitTicket({ v }: { v: PracticeView }) {
  const { me } = useApp();
  const p = v.practice;
  const open = () => go(`/recruit/${encodeURIComponent(p.id)}`);
  const targetGroups =
    v.groupNames.length > 0
      ? v.groupNames
      : p.groups.map((gid) => me.groups.find((g) => g.id === gid)?.name ?? gid);
  const hasGroups = targetGroups.length > 0;

  return (
    <article
      class="ticket"
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
          <MyAnswerBadge answer={v.myAnswer} />
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
        <div class="ticket-groups-row">
          <div class="ticket-groups">
            {hasGroups ? (
              targetGroups.map((name) => (
                <span class="label" key={name}>
                  {name}
                </span>
              ))
            ) : (
              <span class="unrecruited-label">未募集</span>
            )}
          </div>
        </div>
        <TicketSub booker={v.bookerName} date={p.date} studio={p.studio} />
      </button>
    </article>
  );
}

/** 削除ボタンの幅。これより左に引くと開いたままになる */
const DELETE_WIDTH = 82;

/**
 * iPhone のメールのように、左にスワイプすると右端に削除ボタンが出る行。
 * 縦のスクロールは邪魔しない（横に動かしたときだけスワイプにする）。開いている間にチケットを押すと閉じる
 */
function SwipeRow({
  open,
  anyOpen,
  onOpen,
  onDelete,
  children,
}: {
  open: boolean;
  /** どれかの行が開いているか。開いている間のタップは、移らずに閉じるだけにする（iPhone のメールと同じ） */
  anyOpen: boolean;
  onOpen: (open: boolean) => void;
  onDelete: () => void;
  children: ComponentChildren;
}) {
  const [dx, setDx] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; id: number; mode: 'wait' | 'swipe' | 'scroll' } | null>(null);
  // スワイプした直後のクリック（指を離したときに出る）で、練習の画面に移らないようにする
  const swiped = useRef(false);

  const base = open ? -DELETE_WIDTH : 0;
  // ボタンの幅より先は、引いても少ししか動かない
  const raw = dx == null ? base : base + dx;
  const x = Math.min(0, raw < -DELETE_WIDTH ? -DELETE_WIDTH + (raw + DELETE_WIDTH) * 0.25 : raw);

  return (
    <div class={`swipe${open ? ' open' : ''}${dx != null ? ' dragging' : ''}`}>
      <button class="swipe-delete" tabIndex={open ? 0 : -1} aria-hidden={!open} onClick={onDelete}>
        <Icon name="trash" size={20} />
        削除
      </button>
      <div
        class="swipe-body"
        style={{ transform: `translateX(${x}px)`, transition: dx == null ? 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none' }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, mode: 'wait' };
          swiped.current = false;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const mx = e.clientX - d.x;
          const my = e.clientY - d.y;
          if (d.mode === 'wait') {
            if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
            d.mode = Math.abs(mx) > Math.abs(my) ? 'swipe' : 'scroll';
            if (d.mode === 'swipe') {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* 取れなくても、この行の上で動かしている間はスワイプできる */
              }
            }
          }
          if (d.mode === 'swipe') {
            swiped.current = true;
            setDx(mx);
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.mode !== 'swipe') return setDx(null);
          const moved = e.clientX - d.x;
          setDx(null);
          onOpen(base + moved < -DELETE_WIDTH / 2);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDx(null);
        }}
        onClickCapture={(e) => {
          if (swiped.current || anyOpen) {
            e.preventDefault();
            e.stopPropagation();
            // スワイプで開いた直後は開いたまま。それ以外（開いている行がある間のタップ）は閉じる
            if (!swiped.current) onOpen(false);
            swiped.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
