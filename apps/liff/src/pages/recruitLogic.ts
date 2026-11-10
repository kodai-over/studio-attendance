import type { Group, PracticeView } from '@studio-attendance/shared';

export type RecruitScope = 'mine' | 'all';
export const RECRUIT_SCOPE_KEY = 'pb:recruitScope';

export function readRecruitScope(): RecruitScope {
  try {
    const val = localStorage.getItem(RECRUIT_SCOPE_KEY);
    return val === 'all' ? 'all' : 'mine';
  } catch {
    return 'mine';
  }
}

export function saveRecruitScope(scope: RecruitScope): void {
  try {
    localStorage.setItem(RECRUIT_SCOPE_KEY, scope);
  } catch {
    /* localStorage が使えない環境でも安全 */
  }
}

/**
 * 募集画面の一覧対象を絞り込む。
 * 管理者の場合、scope ('mine' | 'all') に応じて「自分のみ」または「すべて」を返す。
 * 一般ユーザーの場合、常に編集権限のあるもの（canEdit）を返す。
 */
export function filterRecruitPractices(
  practices: PracticeView[] | null | undefined,
  isAdmin: boolean,
  userId: string,
  scope: RecruitScope,
): { mine: PracticeView[]; all: PracticeView[]; shown: PracticeView[] } {
  if (!practices) return { mine: [], all: [], shown: [] };
  const canEditList = practices.filter((v) => v.canEdit);
  const mineList = canEditList.filter((v) => v.practice.booker === userId);

  if (!isAdmin) {
    return {
      mine: mineList,
      all: canEditList,
      shown: canEditList,
    };
  }

  return {
    mine: mineList,
    all: canEditList,
    shown: scope === 'all' ? canEditList : mineList,
  };
}

/**
 * 募集済のグループへ「再募集」を送信できるか判定する。
 * - 予約情報の編集権限（canEdit: 予約者または管理者）が必要
 * - 満員の場合は送信不可（disabled）
 */
export function canRemindGroup(v: PracticeView): { canShow: boolean; canSubmit: boolean } {
  return {
    canShow: v.canEdit,
    canSubmit: v.canEdit && v.practice.status !== '満員',
  };
}

/** 一覧でまとめて「募集を送る」に選べるか。自分で送れる、募集済で、まだ始まる前の募集中の予約情報だけ */
export function canPickForRemind(v: PracticeView, today: string): boolean {
  const p = v.practice;
  return v.canEdit && p.groups.length > 0 && p.status === '募集中' && p.date >= today;
}

/** 一覧でまとめて募集を送る送り先の初期値。選んだ予約情報の募集済のグループのうち、本人が選べるものすべて */
export function defaultRemindTargets(picked: PracticeView[], available: Group[]): string[] {
  const sent = new Set(picked.flatMap((v) => v.practice.groups));
  return available.filter((g) => sent.has(g.id)).map((g) => g.id);
}

/**
 * 個別予約詳細画面の「募集を送る」の確認文。
 * 確認用アカウント（actAs === 'test'）の場合は、その旨を明記する。
 */
export function sendConfirmMessage(group: { name: string }, isTestUser = false): string {
  return isTestUser
    ? `確認用アカウント「admin」として、${group.name} に募集カードを送りますか？`
    : `${group.name} に募集カードを送りますか？`;
}

/**
 * 操作者が募集を送信可能なグループ（本人が所属しているグループ）を絞り込む。
 * allGroups: システム内のグループ一覧（me.groups）
 * myGroupIds: 操作者の所属グループID配列（me.member.groups）
 */
export function filterAvailableGroups(
  allGroups: Group[] | undefined | null,
  myGroupIds: string[] | undefined | null,
): Group[] {
  if (!allGroups || allGroups.length === 0) return [];
  if (!myGroupIds || myGroupIds.length === 0) return [];
  const set = new Set(myGroupIds);
  return allGroups.filter((g) => set.has(g.id));
}

/**
 * 操作者が募集を送れるグループを分類する。
 * - unrecruited: 未募集のグループ（本人が所属しており、まだこの予約情報が送られていない）
 * - sent: 募集済のグループ（本人が所属しており、すでにこの予約情報が送られている）
 */
export function resolveRecruitGroups(
  allGroups: Group[] | undefined | null,
  myGroupIds: string[] | undefined | null,
  practiceGroupIds: string[] | undefined | null,
): { unrecruited: Group[]; sent: Group[] } {
  const available = filterAvailableGroups(allGroups, myGroupIds);
  const sentSet = new Set(practiceGroupIds ?? []);
  return {
    unrecruited: available.filter((g) => !sentSet.has(g.id)),
    sent: available.filter((g) => sentSet.has(g.id)),
  };
}
