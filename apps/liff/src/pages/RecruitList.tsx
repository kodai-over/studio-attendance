import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { isAdmin, labelDate, type PracticeView } from '@studio-attendance/shared';
import { deleteMessage } from './Detail';
import { api } from '../api';
import { Icon, Spinner, Stub, TopBar, go, place, useApp, useRunner } from '../ui';

/**
 * 「募集」。自分が登録した練習（管理者はすべての練習）を並べ、押すと募集・編集の画面へ。
 * 左にスワイプすると削除が出る。右上の＋から登録する
 */
export function RecruitListPage() {
  const { me, practices, setPractices, deletePractice } = useApp();
  const [run] = useRunner();
  const [fresh, setFresh] = useState(false);
  // 削除ボタンを出しているチケット（一度に1枚だけ）
  const [opened, setOpened] = useState<string | null>(null);

  // 手元の一覧ですぐ表示し、最新の一覧は裏で取り直す
  useEffect(() => {
    const started = Date.now();
    run(() => api('listPractices')).then((r) => {
      if (r) setPractices(r, true, started);
      setFresh(true);
    });
  }, []);

  const admin = isAdmin(me.member);
  // 直せる練習（自分が登録した練習。管理者はすべて）。サーバーの判定（canEdit）にそろえる
  const list = practices == null && !fresh ? null : (practices ?? []).filter((v) => v.canEdit);

  // 確認したら、サーバーの返事を待たずに一覧から消す（失敗したらその練習だけ元に戻す）
  const remove = (v: PracticeView) => {
    setOpened(null);
    if (confirm(deleteMessage(v))) deletePractice(v);
  };

  return (
    <>
      <TopBar title="募集">
        <button class="icon-btn" aria-label="スタジオ予約を登録" onClick={() => (opened ? setOpened(null) : go('/register'))}>
          <Icon name="plus" />
        </button>
      </TopBar>
      {list == null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <div class="empty">登録されている予約情報はありません。</div>
      ) : (
        <div class="ticket-grid">
          {list.map((v) => (
            <SwipeRow
              key={v.practice.id}
              open={opened === v.practice.id}
              anyOpen={opened != null}
              onOpen={(o) => setOpened(o ? v.practice.id : null)}
              onDelete={() => remove(v)}
            >
              <RecruitTicket v={v} />
            </SwipeRow>
          ))}
        </div>
      )}
    </>
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
    <article class="ticket" data-answer={hasGroups ? 'sent' : 'none'} data-status={p.status}>
      <Stub date={p.date} onClick={open} />
      <button class="ticket-main" onClick={open}>
        <span class="sr">{labelDate(p.date)}</span>
        <div class="time">
          <span>{p.start}–{p.end}</span>
          {v.bookerName && (
            <span class="booker" title={`予約者: ${v.bookerName}`}>
              <Icon name="user" size={11} />
              <span>{v.bookerName}</span>
            </span>
          )}
        </div>
        <div class="place">{place(p)}</div>
        <div class="ticket-foot">
          <div class={`recruit-groups${hasGroups ? ' has-groups' : ''}`}>
            <Icon name="send" size={12} />
            {hasGroups ? (
              targetGroups.map((name) => (
                <span class="tag" key={name}>
                  {name}
                </span>
              ))
            ) : (
              <span class="no-groups">No groups</span>
            )}
          </div>
          <span class="fee">
            <Icon name="chevron" size={15} />
          </span>
        </div>
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
