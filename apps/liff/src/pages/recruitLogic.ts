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
