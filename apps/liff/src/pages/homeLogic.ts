import {
  isPastPractice,
  labelDate,
  yen,
  type Answer,
  type AttendeeView,
  type MeView,
  type PracticeStatus,
  type PracticeView,
} from '@studio-attendance/shared';
import { getDraftOwnerKey } from './answerLogic';

export interface ReleaseNoteSection {
  heading: string;
  items: string[];
}

export interface ReleaseNote {
  version: string;
  date: string;
  summary?: string;
  sections: ReleaseNoteSection[];
}

export const LATEST_RELEASE_VERSION = 'v1.4.0';

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: 'v1.4.0',
    date: '2026-11-02',
    sections: [
      {
        heading: '新しくできること',
        items: [
          '下のメニューに「RSVP」を追加し、今後の予約情報を「未回答」「回答済」に分けて確認・回答できるようになりました（未回答の件数がバッジで表示されます）。',
          '複数のグループに所属している場合は、グループごとに切り替えて回答や「グループに伝える」を行えます。',
          '「回答済」タブで回答を変更すると、「回答を変更しました（例: 行く → 未定）」の文が自動で作られ、「グループに伝える」やコピーでそのまま共有できます。',
          '満員の予約情報で「○ 行く」を押したときは、満員のため選べない旨の案内が表示されます（「△ 未定」「✕ 行かない」は選択できます）。',
        ],
      },
      {
        heading: '変わったこと',
        items: [
          '予定を確認しているときの誤タップで回答が変わってしまうのを防ぐため、「予定」の一覧と予約情報の詳細は確認専用になりました。',
          '下のメニューの「RSVP」から回答するときは、選んだ内容が下書きとして保持され、「回答を反映してグループに伝える」または「回答を反映して完了」を押した時点でまとめて反映されます。',
          '「予定」の上のタブを「すべて」「行く」の2つに整理し、自分の現在の回答を記号（○・△・✕・—）でひと目で確認できるようにしました。',
        ],
      },
    ],
  },
  {
    version: 'v1.3.0',
    date: '2026-11-02',
    sections: [
      {
        heading: '新しくできること',
        items: [
          '募集済のグループがある予約情報を削除する際、「募集済のグループに削除の連絡を送る」を選べるようになりました（初期値はON）。',
          'スクショや文章から予約内容を読み取っている間、処理の目安ステップ（文字の読み取り → 日時・スタジオ情報の確認 → スタジオ代・キャンセル期限の計算）が表示されるようになりました。',
        ],
      },
      {
        heading: '変わったこと',
        items: [
          '予約情報を削除する際、参加者の回答がある場合の警告や削除の連絡オプションが確認画面として統一して表示されるようになり、意図しない誤削除を防ぎやすくしました。',
        ],
      },
    ],
  },
  {
    version: 'v1.2.0',
    date: '2026-11-02',
    sections: [
      {
        heading: '新しくできること',
        items: [
          'LINE Bot との個別トーク下にあるメニューを、「予定確認」「予約登録」「ブラウザで開く」の3つのカード型ボタンに刷新しました。',
          'トーク画面を広く使えるコンパクトなサイズに変更し、見やすいデザインに一新しました。',
        ],
      },
    ],
  },
  {
    version: 'v1.1.0',
    date: '2026-11-02',
    sections: [
      {
        heading: '新しくできること',
        items: [
          '予約情報の一覧や詳細画面に、各スタジオの無料キャンセル期限が表示されるようになりました。',
          '最低人数に届いていないときに届くキャンセル期限前のお知らせから、ボタンひとつで同じグループにもう一度募集を送れるようになりました。',
          'Safari や Chrome などの外部ブラウザで直接アプリを開いたり、ホーム画面に追加して全画面で利用できるようになりました。',
          '画面右上のボタンから、ダークモードとライトモードを手動でいつでも切り替えられるようになりました。',
          'アカウント画面からログアウトし、別の LINE アカウントでログインし直せるようになりました。',
        ],
      },
      {
        heading: '変わったこと',
        items: [
          '予約情報の一覧や画面全体のデザインを見直し、曜日ごとの色分けや満員時の「FULL」表示など、より見やすく整理しました。',
          '下のメニューの表記を「アカウント」「管理画面」にそろえました。',
        ],
      },
    ],
  },
  {
    version: 'v1.0.0',
    date: '2026-10-28',
    summary: '最初のバージョンです。',
    sections: [
      {
        heading: '新しくできること',
        items: [
          '予約画面のスクショや予約完了メールの文章を Bot に送るか、アプリの「募集」の右上の＋から予約情報を登録できるようになりました。',
          '登録と同時に、または登録したあとに、選んだグループへ「参加者募集」のカードを送れます。',
          '募集カードの「回答」から ○ 行く・△ 未定・✕ 行かない を選び、「グループに伝える」で自分の回答をトークに送れます。',
          '予約情報ごとに、参加者・参加人数・スタジオ代・1人あたりを確認でき、「カレンダーに追加」もできます。',
        ],
      },
    ],
  },
];

export type NoticeKind = 'answer' | 'practice_changed' | 'practice_canceled';

export interface HomeNoticeItem {
  id: string;
  kind: NoticeKind;
  practiceId: string;
  participant?: string;
  updatedAt: string;
  title: string;
  detail: string;
  answer?: Answer;
}

export const HOME_READ_EVENT = 'pb:home-read';

function dispatchHomeReadEvent(): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof Event === 'function') {
      window.dispatchEvent(new Event(HOME_READ_EVENT));
    }
  } catch {
    /* イベント発火できない環境でも動作する */
  }
}

export interface PracticeSnapshot {
  date: string;
  start: string;
  end: string;
  studio: string;
  room: string;
  fee: number;
  memo: string;
  status: PracticeStatus;
  answers: Record<string, { answer: Answer; updatedAt?: string; name: string }>;
}

const SNAPSHOT_KEY_PREFIX = 'pb:practiceSnapshots:';
const DETECTED_NOTICES_KEY_PREFIX = 'pb:detectedNotices:';
const NOTICE_READ_AT_KEY_PREFIX = 'pb:noticeReadAt:';
const SEEN_RELEASE_KEY_PREFIX = 'pb:seenRelease:';
const MAX_STORED_NOTICES = 40;

const ANSWER_UI_TEXT: Record<Answer, string> = {
  行く: '○ 行く',
  保留: '△ 未定',
  行かない: '✕ 行かない',
};

function placeText(p: { studio: string; room: string }): string {
  return `${p.studio}${p.room ? ' ' + p.room : ''}`;
}

/**
 * 次の参加予定（「行く」と回答しており、まだ終了しておらず中止でもない直近の予約情報）を返す。
 */
export function getNextGoingPractice(
  practices: PracticeView[] | null,
  today: string,
  currentTime?: string,
): PracticeView | null {
  if (!practices) return null;
  const candidates = practices
    .filter(
      (v) =>
        v.myAnswer === '行く' &&
        v.practice.status !== '中止' &&
        !isPastPractice(v.practice, today, currentTime),
    )
    .sort((a, b) =>
      (a.practice.date + a.practice.start).localeCompare(b.practice.date + b.practice.start),
    );
  return candidates[0] ?? null;
}

/**
 * 自分が関係する予約情報か（自分が行く・未定と回答している、自分が予約者、または所属グループに募集されている）
 */
export function isRelatedForNotice(v: PracticeView, me: MeView): boolean {
  const userId = me.member.userId;
  if (v.practice.booker === userId) return true;
  if (v.myAnswer === '行く' || v.myAnswer === '保留') return true;
  if (v.involved && v.myAnswer !== '行かない') return true;
  return v.practice.groups.some((g) => me.member.groups.includes(g));
}

function collectAttendees(v: PracticeView): AttendeeView[] {
  return [...v.going, ...v.maybe, ...v.notGoing];
}

function toSnapshot(v: PracticeView): PracticeSnapshot {
  const p = v.practice;
  const answers: PracticeSnapshot['answers'] = {};
  for (const a of collectAttendees(v)) {
    answers[a.participant] = {
      answer: a.answer,
      updatedAt: a.updatedAt,
      name: a.name,
    };
  }
  return {
    date: p.date,
    start: p.start,
    end: p.end,
    studio: p.studio,
    room: p.room,
    fee: p.fee,
    memo: p.memo,
    status: p.status,
    answers,
  };
}

function loadSnapshots(ownerKey: string): Record<string, PracticeSnapshot> | null {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return null;
    const raw = localStorage.getItem(SNAPSHOT_KEY_PREFIX + ownerKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, PracticeSnapshot>;
  } catch {
    return null;
  }
}

function saveSnapshots(ownerKey: string, map: Record<string, PracticeSnapshot>): void {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
    localStorage.setItem(SNAPSHOT_KEY_PREFIX + ownerKey, JSON.stringify(map));
  } catch {
    /* localStorage が使えない環境でも動作する */
  }
}

/**
 * 自分自身の操作（予約情報の編集・回答など）で 1 件の PracticeView が更新された際、
 * 次回の syncPracticeNotices で「自分の操作が変更通知として出てしまう」のを防ぐためスナップショットを最新化する。
 */
export function updatePracticeSnapshot(
  v: PracticeView,
  me: Pick<MeView, 'member' | 'actAs'>,
): void {
  const ownerKey = getDraftOwnerKey(me);
  const prevMap = loadSnapshots(ownerKey);
  if (!prevMap) return;
  prevMap[v.practice.id] = toSnapshot(v);
  saveSnapshots(ownerKey, prevMap);
}

function isValidStoredNotice(x: unknown): x is HomeNoticeItem {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const item = x as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    (item.kind === 'answer' || item.kind === 'practice_changed' || item.kind === 'practice_canceled') &&
    typeof item.practiceId === 'string' &&
    typeof item.updatedAt === 'string' &&
    typeof item.title === 'string' &&
    typeof item.detail === 'string'
  );
}

export function loadStoredNotices(ownerKey: string): HomeNoticeItem[] {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return [];
    const raw = localStorage.getItem(DETECTED_NOTICES_KEY_PREFIX + ownerKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidStoredNotice);
  } catch {
    return [];
  }
}

function saveStoredNotices(ownerKey: string, notices: HomeNoticeItem[]): void {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
    localStorage.setItem(
      DETECTED_NOTICES_KEY_PREFIX + ownerKey,
      JSON.stringify(notices.slice(0, MAX_STORED_NOTICES)),
    );
  } catch {
    /* localStorage が使えない環境でも動作する */
  }
}

/**
 * 前回取得した予約情報スナップショットと今回の予約情報一覧を比較し、
 * ① 自分が関係する予約情報の変更・中止通知
 * ② 自分が予約者の予約情報に対するメンバーの回答変更通知（前回答 → 新回答）
 * を検知して保存する。
 */
export function syncPracticeNotices(
  practices: PracticeView[],
  me: MeView,
  nowIso = new Date().toISOString(),
): HomeNoticeItem[] {
  const ownerKey = getDraftOwnerKey(me);
  const prevMap = loadSnapshots(ownerKey);
  const stored = loadStoredNotices(ownerKey);
  const nextMap: Record<string, PracticeSnapshot> = {};
  const newlyDetected: HomeNoticeItem[] = [];

  for (const v of practices) {
    const p = v.practice;
    const snap = toSnapshot(v);
    nextMap[p.id] = snap;

    if (!prevMap) continue;
    const prev = prevMap[p.id];
    if (!prev) continue;

    const pLabel = `${labelDate(p.date)} ${p.start}–${p.end}`;

    // 1. 自分が関係する予約情報の変更・中止の検知
    if (isRelatedForNotice(v, me)) {
      if (prev.status !== '中止' && p.status === '中止') {
        newlyDetected.push({
          id: `cancel:${p.id}:${nowIso}`,
          kind: 'practice_canceled',
          practiceId: p.id,
          updatedAt: nowIso,
          title: `${labelDate(p.date)} の予約情報が中止になりました`,
          detail: `${pLabel} ${placeText(p)}`,
        });
      } else {
        const changes: string[] = [];
        if (prev.date !== p.date) {
          changes.push(`日付: ${labelDate(prev.date)} → ${labelDate(p.date)}`);
        }
        if (prev.start !== p.start || prev.end !== p.end) {
          changes.push(`時間: ${prev.start}–${prev.end} → ${p.start}–${p.end}`);
        }
        if (prev.studio !== p.studio || prev.room !== p.room) {
          changes.push(`場所: ${placeText(prev)} → ${placeText(p)}`);
        }
        if (prev.fee !== p.fee) {
          changes.push(`スタジオ代: ${yen(prev.fee)} → ${yen(p.fee)}`);
        }
        if ((prev.memo ?? '') !== (p.memo ?? '')) {
          changes.push('メモ更新');
        }
        if (changes.length > 0) {
          newlyDetected.push({
            id: `change:${p.id}:${nowIso}`,
            kind: 'practice_changed',
            practiceId: p.id,
            updatedAt: nowIso,
            title: `${labelDate(p.date)} の予約情報が変更されました`,
            detail: `${changes.join(' / ')}（${placeText(p)}）`,
          });
        }
      }
    }

    // 2. 自分が予約者の予約情報に対するメンバーの回答変更の検知
    if (p.booker === me.member.userId) {
      for (const a of collectAttendees(v)) {
        if (a.participant === me.member.userId) continue;
        const prevAtt = prev.answers[a.participant];
        if (prevAtt && prevAtt.answer !== a.answer) {
          const ts = a.updatedAt ?? nowIso;
          newlyDetected.push({
            id: `ans:${p.id}:${a.participant}:${ts}`,
            kind: 'answer',
            practiceId: p.id,
            participant: a.participant,
            updatedAt: ts,
            title: `${a.name}さんが回答を変更しました（${ANSWER_UI_TEXT[prevAtt.answer]} → ${ANSWER_UI_TEXT[a.answer]}）`,
            detail: `${pLabel} ${placeText(p)}`,
            answer: a.answer,
          });
        }
      }
    }
  }

  saveSnapshots(ownerKey, nextMap);

  if (newlyDetected.length > 0) {
    const byId = new Map<string, HomeNoticeItem>();
    const seenParticipantKey = new Set<string>();
    for (const item of [...newlyDetected, ...stored]) {
      if (item.kind === 'answer' && item.participant) {
        const pKey = `${item.practiceId}\0${item.participant}`;
        if (seenParticipantKey.has(pKey)) continue;
        seenParticipantKey.add(pKey);
      }
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    const merged = Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    saveStoredNotices(ownerKey, merged);
    return merged;
  }

  return stored;
}

/**
 * ホーム画面の「お知らせ」に表示する一覧を組み立てる。
 * - 自分が予約者の予約情報に対する他メンバーの回答（サーバー上の出欠データ）
 * - 自分が関係する予約情報で中止になっているもの（スナップショット以前から中止だったものも含む）
 * - スナップショット差分で検知された変更・回答変更履歴
 */
export function buildHomeNotices(
  practices: PracticeView[] | null,
  me: MeView,
  today: string,
  currentTime?: string,
): HomeNoticeItem[] {
  if (!practices) return [];
  const ownerKey = getDraftOwnerKey(me);
  const stored = loadStoredNotices(ownerKey);
  const practiceIds = new Set(practices.map((v) => v.practice.id));

  // 削除された予約情報のお知らせは除外する
  const validStored = stored.filter((n) => practiceIds.has(n.practiceId));
  const byId = new Map<string, HomeNoticeItem>();
  // 同じ（practiceId + participant）の回答変更履歴が既にある場合は重複させない
  const seenParticipantAnswers = new Set<string>();

  for (const item of validStored) {
    if (item.kind === 'answer' && item.participant) {
      const pKey = `${item.practiceId}\0${item.participant}`;
      if (seenParticipantAnswers.has(pKey)) continue;
      seenParticipantAnswers.add(pKey);
    }
    byId.set(item.id, item);
  }

  for (const v of practices) {
    const p = v.practice;
    // 終了した予約情報はサーバー由来の初期リストからは除外する
    if (isPastPractice(p, today, currentTime)) continue;
    const pLabel = `${labelDate(p.date)} ${p.start}–${p.end}`;

    // 1. 自分が予約者の予約情報に対する他メンバーの回答
    if (p.booker === me.member.userId) {
      for (const a of collectAttendees(v)) {
        if (a.participant === me.member.userId) continue;
        const participantKey = `${p.id}\0${a.participant}`;
        if (seenParticipantAnswers.has(participantKey)) continue;
        seenParticipantAnswers.add(participantKey);
        const ts = a.updatedAt ?? p.createdAt;
        const id = `ans:${p.id}:${a.participant}:${ts}`;
        if (!byId.has(id)) {
          byId.set(id, {
            id,
            kind: 'answer',
            practiceId: p.id,
            participant: a.participant,
            updatedAt: ts,
            title: `${a.name}さんが「${ANSWER_UI_TEXT[a.answer]}」と回答しました`,
            detail: `${pLabel} ${placeText(p)}`,
            answer: a.answer,
          });
        }
      }
    }

    // 2. 自分が関係する予約情報で現在「中止」になっているもの
    if (p.status === '中止' && isRelatedForNotice(v, me)) {
      const hasCancelNotice = Array.from(byId.values()).some(
        (n) => n.kind === 'practice_canceled' && n.practiceId === p.id,
      );
      if (!hasCancelNotice) {
        const id = `cancel:${p.id}:${p.createdAt}`;
        byId.set(id, {
          id,
          kind: 'practice_canceled',
          practiceId: p.id,
          updatedAt: p.createdAt,
          title: `${labelDate(p.date)} の予約情報が中止になりました`,
          detail: `${pLabel} ${placeText(p)}`,
        });
      }
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_STORED_NOTICES);
}

export function getNoticeReadAt(me: Pick<MeView, 'member' | 'actAs'>): string | null {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return null;
    return localStorage.getItem(NOTICE_READ_AT_KEY_PREFIX + getDraftOwnerKey(me));
  } catch {
    return null;
  }
}

export function markNoticesRead(
  me: Pick<MeView, 'member' | 'actAs'>,
  latestAt?: string,
): void {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
    const nowIso = new Date().toISOString();
    const stamp = latestAt && latestAt > nowIso ? latestAt : nowIso;
    localStorage.setItem(NOTICE_READ_AT_KEY_PREFIX + getDraftOwnerKey(me), stamp);
    dispatchHomeReadEvent();
  } catch {
    /* 保存できなくても動作する */
  }
}

export function getSeenReleaseVersion(me: Pick<MeView, 'member' | 'actAs'>): string | null {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return null;
    return localStorage.getItem(SEEN_RELEASE_KEY_PREFIX + getDraftOwnerKey(me));
  } catch {
    return null;
  }
}

export function markReleaseNotesRead(
  me: Pick<MeView, 'member' | 'actAs'>,
  version = LATEST_RELEASE_VERSION,
): void {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
    localStorage.setItem(SEEN_RELEASE_KEY_PREFIX + getDraftOwnerKey(me), version);
    dispatchHomeReadEvent();
  } catch {
    /* 保存できなくても動作する */
  }
}

export interface HomeUnreadStatus {
  unreadNoticesCount: number;
  hasUnreadReleaseNote: boolean;
  totalBadgeCount: number;
}

export function getHomeUnreadStatus(
  practices: PracticeView[] | null,
  me: MeView,
  today: string,
  currentTime?: string,
): HomeUnreadStatus {
  const notices = buildHomeNotices(practices, me, today, currentTime);
  const readAt = getNoticeReadAt(me);
  const unreadNoticesCount = readAt
    ? notices.filter((n) => n.updatedAt > readAt).length
    : notices.length;
  const seenVersion = getSeenReleaseVersion(me);
  const hasUnreadReleaseNote = seenVersion !== LATEST_RELEASE_VERSION;
  const totalBadgeCount = unreadNoticesCount + (hasUnreadReleaseNote ? 1 : 0);
  return {
    unreadNoticesCount,
    hasUnreadReleaseNote,
    totalBadgeCount,
  };
}

/**
 * ISO日時文字列を「11/02 19:30」のような短いJST表示に整形する。
 */
export function formatNoticeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const jst = new Date(d.getTime() + 9 * 3600_000);
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jst.getUTCDate()).padStart(2, '0');
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const mm = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${m}/${day} ${hh}:${mm}`;
}
