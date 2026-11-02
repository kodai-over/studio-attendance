import {
  answerChangeReport,
  answerReport,
  type Answer,
  type PracticeView,
} from '@studio-attendance/shared';

export type StageMap = Map<string, Answer>;

export interface ModifiedItem {
  id: string;
  answer: Answer;
  originalAnswer: Answer | null;
  practice: PracticeView['practice'];
}

/**
 * 下書き（ドラフト）を更新する純粋関数。
 * 元の回答と同じ値が選ばれた場合は下書きから削除し、異なれば追加/更新する。
 */
export function stageAnswer(
  staged: StageMap,
  id: string,
  answer: Answer,
  originalAnswer: Answer | null,
): StageMap {
  const next = new Map(staged);
  if (originalAnswer === answer) {
    next.delete(id);
  } else {
    next.set(id, answer);
  }
  return next;
}

/**
 * 現在の下書きから、元の回答と差分がある項目一覧を抽出する。
 */
export function getModifiedItems(
  staged: StageMap,
  list: PracticeView[] | null | undefined,
): ModifiedItem[] {
  if (!list) return [];
  const items: ModifiedItem[] = [];
  for (const [id, answer] of staged.entries()) {
    const original = list.find((x) => x.practice.id === id);
    if (original && original.myAnswer !== answer) {
      items.push({
        id,
        answer,
        originalAnswer: original.myAnswer,
        practice: original.practice,
      });
    }
  }
  return items;
}

/**
 * 保存成功した項目の ID を下書きから除外し、失敗した項目のみを残す。
 */
export function cleanupAfterCommit(staged: StageMap, succeededIds: string[]): StageMap {
  const next = new Map(staged);
  for (const id of succeededIds) {
    next.delete(id);
  }
  return next;
}

/**
 * 選択中グループに合致する予約情報を抽出する。
 * groups が空の予約情報（登録のみ等）や、自分が予約者の予約情報はどのグループ選択時にも表示する。
 */
export function filterGroupPractices(
  practices: PracticeView[],
  selectedGroup: string,
  myUserId?: string,
): PracticeView[] {
  if (!selectedGroup) return practices;
  return practices.filter((v) => {
    if (v.practice.groups.length === 0) return true;
    if (v.practice.groups.includes(selectedGroup)) return true;
    if (myUserId && v.practice.booker === myUserId) return true;
    return false;
  });
}

/**
 * 表示中かつ選択中グループに合致する変更項目のみをフィルタリングする。
 * groups が空の予約情報や自分が予約者の予約情報はどのグループ選択時にも対象に含める。
 */
export function filterTargetModifiedItems(
  modifiedItems: ModifiedItem[],
  displayedIds: Set<string>,
  selectedGroup: string,
  myUserId?: string,
): ModifiedItem[] {
  return modifiedItems.filter((item) => {
    if (!displayedIds.has(item.id)) return false;
    if (!selectedGroup || item.practice.groups.length === 0) return true;
    if (item.practice.groups.includes(selectedGroup)) return true;
    if (myUserId && item.practice.booker === myUserId) return true;
    return false;
  });
}

/**
 * 特定指定（isSpecific）時の送信メッセージを生成する。
 * 未回答からの新規回答と、回答済からの変更が混在していても正しく結合して生成する。
 */
export function generateSpecificReport(
  displayed: PracticeView[],
  modifiedItems: ModifiedItem[],
): string {
  // 中止以外の変更対象
  const activeItems = modifiedItems.filter((m) => m.practice.status !== '中止');
  if (activeItems.length === 0) return '';

  const newAnswers = activeItems.filter((m) => m.originalAnswer == null);
  const changedAnswers = activeItems.filter((m) => m.originalAnswer != null);

  const parts: string[] = [];

  if (newAnswers.length > 0) {
    const report = answerReport(
      newAnswers.map((m) => ({ practice: m.practice, answer: m.answer })),
    );
    if (report) parts.push(report);
  }

  if (changedAnswers.length > 0) {
    const report = answerChangeReport(
      changedAnswers.map((m) => ({ practice: m.practice, from: m.originalAnswer, to: m.answer })),
    );
    if (report) parts.push(report);
  }

  return parts.join('\n\n');
}
