/**
 * `npm run dev:mock` 用。Apps Script と同じ業務ロジックをブラウザ内のメモリで動かし、
 * LINEやGoogleの準備がなくても画面を確かめられるようにする。
 */
import { addDays, DEFAULT_FEES, DEFAULT_STUDIOS, makePracticeId, toJstDate, type LineMessage, type Practice } from '@studio-attendance/shared';
import { MemoryKv, MemoryStore } from '../../gas/src/app/memory';
import type { Ctx } from '../../gas/src/app/ports';
import { route } from '../../gas/src/app/router';

const today = toJstDate(new Date());
const store = new MemoryStore();
store.m = [
  { userId: 'Ume', name: 'おおゆち', role: '管理者', defaultGroups: ['G1', 'G2', 'G3'], groups: ['G1', 'G2', 'G3'] },
  { userId: 'U2', name: 'さくら', role: '予約者', defaultGroups: ['G2'], groups: ['G1', 'G2'] },
  { userId: 'U3', name: 'けんた', role: '一般', defaultGroups: ['G1'], groups: ['G1'] },
  { userId: 'U4', name: 'みお', role: '一般', defaultGroups: ['G2'], groups: ['G2'] },
  { userId: 'U5', name: 'れん', role: '一般', defaultGroups: ['G1'], groups: ['G1', 'G2'] },
  { userId: 'U6', name: 'あおい', role: '一般', defaultGroups: ['G1'], groups: ['G1'] },
  { userId: 'U7', name: 'たくみ', role: '一般', defaultGroups: ['G2'], groups: ['G2', 'G3'] },
  { userId: 'U8', name: 'ひなた', role: '一般', defaultGroups: [], groups: ['G2'] },
];
store.s = {
  studios: DEFAULT_STUDIOS,
  fees: DEFAULT_FEES,
  cancelRules: [
    { studio: 'worcle', daysBefore: 4, time: '10:00' },
    { studio: 'BUZZ', daysBefore: 2, time: '10:00' },
  ],
  minDefault: 3,
  roundUnit: 10,
  groups: [
    { id: 'G1', name: 'ショーケース組' },
    { id: 'G2', name: 'サークル全体' },
    { id: 'G3', name: 'バトル練習会' },
  ],
};

const mk = (days: number, start: string, end: string, studio: string, room: string, fee: number, booker: string, over: Partial<Practice> = {}): Practice => {
  const date = addDays(today, days);
  return {
    id: makePracticeId({ studio, date, start, room }),
    date,
    start,
    end,
    studio,
    room,
    fee,
    booker,
    max: null,
    min: null,
    memo: '',
    status: '募集中',
    groups: ['G1'],
    joinKey: 'mockkey',
    feeOverride: null,
    warned: false,
    createdAt: new Date().toISOString(),
    ...over,
  };
};
store.p = [
  // 1. 平日・募集中・自分「行く」・通常
  mk(1, '19:00', '21:00', 'studio worcle 横浜', '202', 4400, 'Ume', {
    groups: ['G1'],
    memo: 'ショーケースの立ち位置確認・通し練習',
  }),
  // 2. 祝日（文化の日 11/3）・満員・自分「未定」・複数グループ
  mk(2, '13:00', '17:00', 'BUZZ横浜東口', 'Bst', 7200, 'U2', {
    max: 4,
    status: '満員',
    groups: ['G1', 'G2'],
    memo: '定員4名。外部講師を招いてのWS',
  }),
  // 3. 土曜日（青系）・自分「行かない」・予約者さくら・高額料金（¥11,800）
  mk(6, '18:00', '21:00', 'studio worcle 原宿', '101', 11800, 'U2', {
    groups: ['G2'],
    memo: '合同ナンバー合同練習',
  }),
  // 4. 日曜日（赤系）・自分「未回答」・大人数参加（アバタースタック +3）
  mk(7, '10:00', '13:00', 'BUZZ渋谷', '渋谷A', 8400, 'Ume', {
    groups: ['G2', 'G3'],
    memo: 'サークル全体練習会（初心者歓迎！）',
  }),
  // 5. 平日・未募集・参加者0人
  mk(10, '20:00', '22:00', 'スタジオよこはま', 'Room A', 3000, 'Ume', {
    groups: [],
    memo: '自主練枠（メンバー募集中）',
  }),
  // 6. 土曜日・定員あり（空きあり 3/6名）・予約者けんた・自分未回答
  mk(13, '17:00', '20:00', 'BUZZ横浜駅前', 'Ast', 4800, 'U3', {
    max: 6,
    groups: ['G1', 'G3'],
    memo: 'バトル練習会・ルーティン合わせ（定員6名）',
  }),
  // 7. 祝日（勤労感謝の日 11/23）・3グループ指定・最低人数設定（未達）
  mk(22, '12:00', '16:00', 'studio worcle 横浜', '106', 14400, 'U2', {
    min: 5,
    groups: ['G1', 'G2', 'G3'],
    memo: '祝日スペシャル練習会。最低5人集まれば開催！',
  }),
  // 8. 最低人数未達 かつ キャンセル期限超過（worcleは4日前期限、3日後開催で現在2/8人・最低4人）
  mk(3, '19:00', '21:00', 'studio worcle 横浜', '301', 4400, 'Ume', {
    min: 4,
    max: 8,
    groups: ['G1'],
    memo: '最低人数4人に未達のままキャンセル期限を過ぎている枠',
  }),
];

let attOffsetMins = 180;
const att = (practiceId: string, participant: string, name: string, answer: '行く' | '保留' | '行かない', kind: 'メンバー' | 'ゲスト' = 'メンバー', addedBy = participant) => {
  attOffsetMins = Math.max(5, attOffsetMins - 7);
  return store.saveAttendance({
    practiceId,
    participant,
    name,
    kind,
    via: kind === 'ゲスト' ? 'アプリ' : 'ボタン',
    addedBy,
    answer,
    updatedAt: new Date(Date.now() - attOffsetMins * 60_000).toISOString(),
  });
};

// 1. 平日 worcle 横浜 (store.p[0])
att(store.p[0].id, 'Ume', 'おおゆち', '行く');
att(store.p[0].id, 'U3', 'けんた', '行く');
att(store.p[0].id, 'U5', 'れん', '行く');
att(store.p[0].id, 'guest:1', 'りな', '行く', 'ゲスト', 'U3');
att(store.p[0].id, 'U2', 'さくら', '保留');
att(store.p[0].id, 'U4', 'みお', '行かない');

// 2. 祝日 BUZZ横浜東口 (store.p[1] - 満員4名)
att(store.p[1].id, 'U2', 'さくら', '行く');
att(store.p[1].id, 'U3', 'けんた', '行く');
att(store.p[1].id, 'U6', 'あおい', '行く');
att(store.p[1].id, 'guest:2', 'しょう', '行く', 'ゲスト', 'U2');
att(store.p[1].id, 'Ume', 'おおゆち', '保留');
att(store.p[1].id, 'U7', 'たくみ', '行かない');

// 3. 土曜 worcle 原宿 (store.p[2])
att(store.p[2].id, 'U2', 'さくら', '行く');
att(store.p[2].id, 'U3', 'けんた', '行く');
att(store.p[2].id, 'U7', 'たくみ', '行く');
att(store.p[2].id, 'U5', 'れん', '保留');
att(store.p[2].id, 'Ume', 'おおゆち', '行かない');

// 4. 日曜 BUZZ渋谷 (store.p[3] - 大人数 7名行く、自分未回答)
att(store.p[3].id, 'U2', 'さくら', '行く');
att(store.p[3].id, 'U3', 'けんた', '行く');
att(store.p[3].id, 'U4', 'みお', '行く');
att(store.p[3].id, 'U5', 'れん', '行く');
att(store.p[3].id, 'U6', 'あおい', '行く');
att(store.p[3].id, 'U7', 'たくみ', '行く');
att(store.p[3].id, 'U8', 'ひなた', '行く');
att(store.p[3].id, 'guest:3', 'ユウキ', '保留', 'ゲスト', 'U2');

// 5. スタジオよこはま (store.p[4] - 0人)
// 回答なし

// 6. BUZZ横浜駅前 (store.p[5] - 定員6名、現在3名行く)
att(store.p[5].id, 'U3', 'けんた', '行く');
att(store.p[5].id, 'U5', 'れん', '行く');
att(store.p[5].id, 'U7', 'たくみ', '行く');
att(store.p[5].id, 'U2', 'さくら', '保留');

// 7. 祝日 worcle 横浜 (store.p[6] - 最低5人設定で2人行く)
att(store.p[6].id, 'U2', 'さくら', '行く');
att(store.p[6].id, 'Ume', 'おおゆち', '行く');
att(store.p[6].id, 'U3', 'けんた', '保留');
att(store.p[6].id, 'U4', 'みお', '保留');

// 8. worcle 横浜 301 (store.p[7] - 最低4人設定・上限8人で2人行く・キャンセル期限超過)
att(store.p[7].id, 'Ume', 'おおゆち', '行く');
att(store.p[7].id, 'U3', 'けんた', '行く');
att(store.p[7].id, 'U5', 'れん', '保留');

store.f = [
  { id: 'f1', userId: 'U3', name: 'けんた', text: '練習の前日にリマインドがほしい', status: '改善済み', reply: '前日にアプリの「自分が行く」で確認できるようにしました', createdAt: new Date(Date.now() - 86400000).toISOString() },
  { id: 'f2', userId: 'U4', name: 'みお', text: 'スタジオの地図リンクを載せてほしい', status: '未対応', reply: '', createdAt: new Date().toISOString() },
];

let seq = 0;
const ctx: Ctx = {
  store,
  kv: new MemoryKv(),
  line: {
    reply() {},
    push(to: string, messages: LineMessage[]) {
      console.info('[mock push]', to, messages);
    },
    profile: () => null,
    groupMemberProfile: () => null,
    groupSummary: () => null,
    content: () => ({ mimeType: 'image/jpeg', data: '' }),
    showLoading: () => {},
  },
  reader: {
    // 予約一覧のスクショ（過去の予約・続けて取った予約・延長・読めない行を含む）を読んだ想定
    read: () => [
      { date: addDays(today, -3), start: '19:00', end: '20:30', studio: '横浜', room: '301', fee: 2400 },
      { date: addDays(today, 12), start: '19:00', end: '20:30', studio: '横浜', room: '301', fee: 2400 },
      { date: addDays(today, 12), start: '20:30', end: '21:00', studio: '横浜', room: '301', fee: 800 },
      { date: addDays(today, 2), start: '21:00', end: '22:00', studio: 'わーくる横浜', room: '202', fee: 2200 },
      { date: addDays(today, 14), start: null, end: null, studio: 'BUZZ横浜', room: '1', fee: null },
    ],
  },
  withLock: (fn) => fn(),
  config: { appUrl: location.origin + location.pathname, joinPageUrl: new URL('join.html', location.href).href, gasUrl: '#' },
  now: () => new Date(),
  uuid: () => `mock${++seq}`,
  log: (...a) => console.log(...a),
};

export async function mockRoute(body: Record<string, unknown>) {
  // 読み取りは本番でも時間がかかるので、モックでも待たせて表示を確かめられるようにする
  await new Promise((r) => setTimeout(r, body.action === 'parseReservations' ? 2000 : 150));
  const user = new URLSearchParams(location.search).get('as') ?? 'Ume';
  return route(ctx, JSON.stringify({ ...body, idToken: 'mock' }), { relay: () => false, idToken: () => ({ userId: user, name: 'ゲストユーザー' }) });
}
