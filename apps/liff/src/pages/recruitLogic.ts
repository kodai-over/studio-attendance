import type { PracticeView } from '@studio-attendance/shared';

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
 * 募集済のグループへ「もう一度募集」を送信できるか判定する。
 * - 予約情報の編集権限（canEdit: 予約者または管理者）が必要
 * - 満員の場合は送信不可（disabled）
 */
export function canRemindGroup(v: PracticeView): { canShow: boolean; canSubmit: boolean } {
  return {
    canShow: v.canEdit,
    canSubmit: v.canEdit && v.practice.status !== '満員',
  };
}

/**
 * 確認ダイアログを経て「もう一度募集」を実行する。
 * キャンセルされた場合は false を返し onRemind は実行しない。
 * 確認用アカウント（actAs === 'test'）の場合は確認文にその旨を明記する。
 */
export async function confirmAndRemind(
  group: { id: string; name: string },
  onRemind: (groupId: string) => Promise<unknown>,
  isTestUser = false,
  confirmFn: (msg: string) => boolean = (msg) => (typeof confirm !== 'undefined' ? confirm(msg) : true),
): Promise<boolean> {
  const msg = isTestUser
    ? `確認用アカウント「admin」として、${group.name} にもう一度募集カードを送りますか？`
    : `${group.name} にもう一度募集カードを送りますか？`;
  if (!confirmFn(msg)) {
    return false;
  }
  await onRemind(group.id);
  return true;
}
