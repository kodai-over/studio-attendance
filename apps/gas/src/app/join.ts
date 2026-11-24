/** 参加リンク（LINEを使わない人の出欠）。合言葉が合う練習への出欠登録だけができる */
import {
  appLink,
  buildIcs,
  deriveIcsKey,
  goingList,
  isActive,
  isAnswer,
  perPersonFee,
  roomInfo,
  safeEqual,
  toJstDate,
  type Answer,
  type JoinActions,
  type JoinView,
  type Practice,
} from '@studio-attendance/shared';
import { UserError, type Ctx } from './ports';
import { recordAnswer } from './practices';

function openPractice(ctx: Ctx, id: unknown, key: unknown): Practice {
  const p = typeof id === 'string' ? ctx.store.getPractice(id) : null;
  if (!p || typeof key !== 'string' || !key || !p.joinKey || !safeEqual(p.joinKey, key)) throw new UserError('参加リンクが無効です');
  if (p.status === '終了' || p.date < toJstDate(ctx.now())) throw new UserError('この予約情報は終了しました');
  return p;
}

function joinView(ctx: Ctx, p: Practice, participant?: string): JoinView {
  const att = ctx.store.attendance(p.id);
  const going = goingList(att, p.id).length;
  const settings = ctx.store.settings();
  const mine = participant ? att.find((a) => a.participant === participant && a.via === '参加リンク') : undefined;
  return {
    id: p.id,
    date: p.date,
    start: p.start,
    end: p.end,
    studio: p.studio,
    room: p.room,
    roomInfo: roomInfo(settings.studios, p.studio, p.room),
    memo: p.memo,
    status: p.status,
    goingCount: going,
    perPerson: perPersonFee(p.fee, going, settings.roundUnit, p.feeOverride),
    myAnswer: mine?.answer ?? null,
  };
}

/** 1つの予約情報に対して参加リンクから新規登録できるゲスト数の上限 */
const MAX_JOIN_LINK_GUESTS = 30;
/** 同一予約情報への参加リンクからの新規登録レート制限（1分間に20件まで。既存回答の更新は制限しない） */
const JOIN_RATE_WINDOW_SEC = 60;
const JOIN_RATE_LIMIT = 20;

/** 有効な予約情報かつ .ics 専用の導出キーが一致するときだけ .ics 本文を返す */
export function buildPracticeIcs(ctx: Ctx, id: unknown, key: unknown): string | null {
  if (typeof id !== 'string' || !id || typeof key !== 'string' || !key) return null;
  const p = ctx.store.getPractice(id);
  if (!p || !isActive(p) || !p.joinKey || !safeEqual(key, deriveIcsKey(p.id, p.joinKey))) return null;
  return buildIcs(p, appLink(ctx.config.appUrl, { p: p.id }), ctx.now());
}

export function handleJoin(ctx: Ctx, action: string, params: Record<string, unknown>): unknown {
  if (action === 'get') {
    const { id, key, participant } = params as JoinActions['get']['params'];
    return joinView(ctx, openPractice(ctx, id, key), participant);
  }
  if (action === 'answer') {
    const { id, key, name, answer, participant } = params as JoinActions['answer']['params'];
    const p = openPractice(ctx, id, key);
    if (!isAnswer(answer)) throw new UserError('回答が不正です');
    const n = typeof name === 'string' ? name.trim().slice(0, 30) : '';
    if (!n) throw new UserError('名前を入力してください');
    // 同じ端末からの回答し直しは、前回の登録を更新する
    const att = ctx.store.attendance(p.id);
    const prev =
      typeof participant === 'string' && participant.startsWith('guest:')
        ? att.find((a) => a.participant === participant && a.via === '参加リンク')
        : undefined;
    if (!prev) {
      const linkGuests = att.filter((a) => a.via === '参加リンク').length;
      if (linkGuests >= MAX_JOIN_LINK_GUESTS) throw new UserError('参加リンクからの登録上限に達しました');
      const rateKey = `joinrate:${p.id}:${Math.floor(ctx.now().getTime() / (JOIN_RATE_WINDOW_SEC * 1000))}`;
      const count = Number(ctx.kv.get(rateKey) ?? '0');
      if (count >= JOIN_RATE_LIMIT) throw new UserError('短時間に登録が集中しています。少し時間をおいてお試しください');
      ctx.kv.put(rateKey, String(count + 1), JOIN_RATE_WINDOW_SEC);
    }
    const pid = prev?.participant ?? `guest:${ctx.uuid()}`;
    const res = recordAnswer(ctx, p.id, { participant: pid, name: n, kind: 'ゲスト', via: '参加リンク', addedBy: '' }, answer as Answer);
    if (!res.ok) throw new UserError(res.reason);
    return { ...joinView(ctx, p, pid), participant: pid };
  }
  throw new UserError('不明な操作です');
}
