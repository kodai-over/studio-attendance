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
import changelogRaw from '../../../../CHANGELOG.md?raw';
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

/**
 * CHANGELOG.md の Markdown テキストからリリースノート一覧を自動生成する。
 * これにより CHANGELOG.md とアプリ内リリースノートの二重管理を防ぐ。
 */
export function parseChangelog(md: string): ReleaseNote[] {
  const notes: ReleaseNote[] = [];
  let current: ReleaseNote | null = null;
  let currentSec: ReleaseNoteSection | null = null;
  let pendingHeading: string | null = null;

  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const verMatch = line.match(/^##\s+(v[0-9]+\.[0-9]+\.[0-9]+)(?:[（(]([^）)]+)[）)])?/);
    if (verMatch) {
      current = {
        version: verMatch[1],
        date: verMatch[2] ?? '',
        sections: [],
      };
      notes.push(current);
      currentSec = null;
      pendingHeading = null;
      continue;
    }
    if (!current) continue;

    const secMatch = line.match(/^###\s+(.+)/);
    if (secMatch) {
      currentSec = {
        heading: secMatch[1].trim(),
        items: [],
      };
      current.sections.push(currentSec);
      pendingHeading = null;
      continue;
    }

    const bulletMatch = line.match(/^(\s*)-\s+(.+)/);
    if (bulletMatch) {
      if (!currentSec) {
        currentSec = { heading: '更新内容', items: [] };
        current.sections.push(currentSec);
      }
      const indent = bulletMatch[1].length;
      const rawItem = bulletMatch[2].trim();

      if (indent === 0) {
        // 親の箇条書きが来たら以前の保留中見出しはリセットする
        pendingHeading = null;
        const headingOnlyMatch = rawItem.match(/^\*\*(.+?)\*\*[:：]\s*$/);
        if (headingOnlyMatch) {
          pendingHeading = headingOnlyMatch[1].trim();
          continue;
        }
      }

      const cleanText = rawItem
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim();

      if (!cleanText) continue;

      if (indent >= 2 && pendingHeading) {
        // 次の親箇条書きや ### が来るまで pendingHeading を保持し、複数の子箇条書きに引き継ぐ
        currentSec.items.push(`${pendingHeading}: ${cleanText}`);
      } else {
        currentSec.items.push(cleanText);
      }
      continue;
    }

    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---') && current.sections.length === 0) {
      current.summary = current.summary ? `${current.summary} ${trimmed}` : trimmed;
    }
  }

  return notes;
}

export const RELEASE_NOTES: ReleaseNote[] = parseChangelog(changelogRaw);
export const LATEST_RELEASE_VERSION: string = RELEASE_NOTES[0]?.version ?? '';

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
  行く: '行く',
  保留: '未定',
  行かない: '行かない',
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

function isValidSnapshot(x: unknown): x is PracticeSnapshot {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.status === 'string' &&
    typeof s.date === 'string' &&
    typeof s.start === 'string' &&
    typeof s.end === 'string' &&
    typeof s.studio === 'string' &&
    typeof s.room === 'string' &&
    typeof s.fee === 'number' &&
    s.answers != null &&
    typeof s.answers === 'object' &&
    !Array.isArray(s.answers)
  );
}

function loadSnapshots(ownerKey: string): Record<string, PracticeSnapshot> | null {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return null;
    const raw = localStorage.getItem(SNAPSHOT_KEY_PREFIX + ownerKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const validMap: Record<string, PracticeSnapshot> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidSnapshot(v)) {
        validMap[k] = v;
      }
    }
    return validMap;
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
  try {
    const ownerKey = getDraftOwnerKey(me);
    const prevMap = loadSnapshots(ownerKey);
    if (!prevMap) return;
    prevMap[v.practice.id] = toSnapshot(v);
    saveSnapshots(ownerKey, prevMap);
  } catch {
    /* 失敗しても本体操作を妨げない */
  }
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
 * 前回取得した予約情報スナップショット（端末の localStorage）と今回の予約情報一覧を比較し、
 * ① 自分が関係する予約情報の変更・中止通知
 * ② 自分が予約者の予約情報に対するメンバーの回答変更通知（前回答 → 新回答）
 * を検知して保存する。
 *
 * ※設計仕様:
 * - スプレッドシートの列や構成を変えずに差分通知を実現するため、前回スナップショットと既読時刻は端末ごとの localStorage に保持する。
 * - 初回起動時（prevMap === null）は既存データが大量に未読通知されないよう現時点を既読基準時刻として記録する。
 * - 予約情報の変更・中止の検知時刻には検知時の端末時刻（nowIso）を用い、回答のお知らせには出欠シートのサーバー記録時刻（a.updatedAt）を用いる。
 *   （スプレッドシートの練習シートには更新日時列を設けていないため、軽微な端末時計のずれは許容し、`markNoticesRead` では `latestAt` と `nowIso` の大きい方を既読時刻として記録することで既読漏れを防いでいる）
 */
export function syncPracticeNotices(
  practices: PracticeView[],
  me: MeView,
  nowIso = new Date().toISOString(),
): HomeNoticeItem[] {
  try {
    const ownerKey = getDraftOwnerKey(me);
    const prevMap = loadSnapshots(ownerKey);
    const stored = loadStoredNotices(ownerKey);
    const nextMap: Record<string, PracticeSnapshot> = {};
    const newlyDetected: HomeNoticeItem[] = [];

    // 初回起動時（既読時刻が未保存 かつ 前回スナップショットなし）は、過去の全回答が未読にならないようベースライン既読時刻を設定する
    if (!prevMap && !getNoticeReadAt(me)) {
      let latestExisting = nowIso;
      for (const v of practices) {
        if (v.practice.createdAt > latestExisting) latestExisting = v.practice.createdAt;
        for (const a of collectAttendees(v)) {
          if (a.updatedAt && a.updatedAt > latestExisting) latestExisting = a.updatedAt;
        }
      }
      try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
          localStorage.setItem(NOTICE_READ_AT_KEY_PREFIX + ownerKey, latestExisting);
        }
      } catch {
        /* 保存できなくても動作する */
      }
    }

    for (const v of practices) {
      const p = v.practice;
      const snap = toSnapshot(v);
      nextMap[p.id] = snap;

      if (!prevMap) continue;
      const prev = prevMap[p.id];
      if (!prev) continue;

      const pLabel = `${labelDate(p.date)} ${p.start}–${p.end}`;

      // 1. 自分が関係する予約情報の変更・中止の検知（予約者自身が変更・中止した予約情報は自分宛てに通知しない）
      if (p.booker !== me.member.userId && isRelatedForNotice(v, me)) {
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

      // 2. 自分が予約者の予約情報に対するメンバーの回答変更の検知（「未定」はお知らせ対象外）
      if (p.booker === me.member.userId) {
        for (const a of collectAttendees(v)) {
          if (a.participant === me.member.userId) continue;
          if (a.answer === '保留') continue;
          const prevAtt = prev.answers?.[a.participant];
          if (prevAtt && prevAtt.answer !== a.answer) {
            const ts = a.updatedAt || nowIso;
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
  } catch {
    // お知らせは付加機能のため、localStorage破損や例外時でも本体の起動・一覧取得を巻き込まない
    return [];
  }
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

  // 削除された予約情報のお知らせ、および「未定」の回答通知は除外する
  const validStored = stored.filter(
    (n) => practiceIds.has(n.practiceId) && (n.kind !== 'answer' || n.answer !== '保留'),
  );
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

    // 1. 自分が予約者の予約情報に対する他メンバーの回答（「未定」はお知らせ対象外）
    if (p.booker === me.member.userId) {
      for (const a of collectAttendees(v)) {
        if (a.participant === me.member.userId) continue;
        if (a.answer === '保留') continue;
        const participantKey = `${p.id}\0${a.participant}`;
        if (seenParticipantAnswers.has(participantKey)) continue;
        seenParticipantAnswers.add(participantKey);
        const ts = a.updatedAt || p.createdAt;
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

    // 2. 自分が関係する予約情報で現在「中止」になっているもの（自分が予約者として自分で中止にした場合は除く）
    if (p.status === '中止' && p.booker !== me.member.userId && isRelatedForNotice(v, me)) {
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
  if (!version) return;
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
  // 初回（readAt === null）は既存の過去回答が大量に未読バッジにならないよう 0 件として扱い、初回 sync 以降の差分のみを未読とする
  const unreadNoticesCount = readAt
    ? notices.filter((n) => n.updatedAt > readAt).length
    : 0;
  const seenVersion = getSeenReleaseVersion(me);
  const hasUnreadReleaseNote =
    RELEASE_NOTES.length > 0 && Boolean(LATEST_RELEASE_VERSION) && seenVersion !== LATEST_RELEASE_VERSION;
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
