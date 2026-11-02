import {
  answerChangeReport,
  answerReport,
  type Answer,
  type PracticeView,
} from '@studio-attendance/shared';

export type StageMap = Map<string, Answer>;

export interface DraftStore {
  specific: StageMap;
  unanswered: StageMap;
  answered: StageMap;
}

/**
 * 画面切り替えやアンマウントで下書きが失われないよう、モジュールレベルで保持
 */
export const globalDrafts: DraftStore = {
  specific: new Map(),
  unanswered: new Map(),
  answered: new Map(),
};

export function clearGlobalDrafts() {
  globalDrafts.specific.clear();
  globalDrafts.unanswered.clear();
  globalDrafts.answered.clear();
}

/**
 * サーバーから取得した最新の予約一覧と照合し、
 * 存在しない予約や、すでに同一の回答になっている下書きを安全に削除する。
 */
export function pruneStaleDrafts(list: PracticeView[]): void {
  const practiceMap = new Map(list.map((v) => [v.practice.id, v.myAnswer]));
  for (const tab of ['unanswered', 'answered', 'specific'] as const) {
    const staged = globalDrafts[tab];
    for (const [id, answer] of staged.entries()) {
      if (!practiceMap.has(id) || practiceMap.get(id) === answer) {
        staged.delete(id);
      }
    }
  }
}

export interface SpecificChange {
  practice: PracticeView['practice'];
  from: Answer | null;
  to: Answer;
}

export type SpecificChangeMap = Map<string, SpecificChange>;

/**
 * 特定予約モード（?r=）での回答選択時に変更履歴を記録する。
 * 最初から回答変更を繰り返した場合（例: 未回答 -> 行く -> 行かない）でも、
 * 最初の元の回答（from）を保持しつつ最新の回答（to）を更新する。
 * 元の回答と同じ値に戻った場合（例: 行く -> 未定 -> 行く）は履歴から除外する。
 */
export function recordSpecificChange(
  current: SpecificChangeMap,
  practice: PracticeView['practice'],
  originalAnswer: Answer | null,
  newAnswer: Answer,
): SpecificChangeMap {
  const next = new Map(current);
  const existing = next.get(practice.id);
  const from = existing ? existing.from : originalAnswer;
  if (from === newAnswer) {
    next.delete(practice.id);
  } else {
    next.set(practice.id, {
      practice,
      from,
      to: newAnswer,
    });
  }
  return next;
}

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

export interface CommitResult {
  succeeded: number;
  failed: number;
  succeededIds: string[];
  lastError: Error | null;
}

/**
 * 複数件の回答保存処理を実行する。
 * 各項目を順次保存し、成功数・失敗数・成功したID一覧・最後のエラーを返す。
 */
export async function processCommitItems(
  items: ModifiedItem[],
  saveItem: (item: ModifiedItem) => Promise<void>,
): Promise<CommitResult> {
  let succeeded = 0;
  let failed = 0;
  const succeededIds: string[] = [];
  let lastError: Error | null = null;

  for (const item of items) {
    try {
      await saveItem(item);
      succeeded++;
      succeededIds.push(item.id);
    } catch (err) {
      failed++;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  return { succeeded, failed, succeededIds, lastError };
}

/**
 * グループ送信（またはコピー）失敗時に、送信文が失われないよう下書きを復元する。
 */
export function restoreDraftOnTellError(
  currentDraft: string | null,
  capturedBody: string,
): string {
  return capturedBody.trim();
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
    if (v.myAnswer != null) return true;
    return false;
  });
}

/**
 * 表示中かつ選択中グループに合致する変更項目のみをフィルタリングする。
 * groups が空の予約情報や自分が予約者の予約情報、回答済みの予約情報はどのグループ選択時にも対象に含める。
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
    if (item.originalAnswer != null) return true;
    return false;
  });
}

/**
 * 特定指定（isSpecific）時の送信メッセージを生成する。
 * 未回答からの新規回答と、回答済からの変更が混在していても正しく結合して生成する。
 */
export function generateSpecificReport(changes: Iterable<SpecificChange>): string {
  const items = Array.from(changes).filter((c) => c.practice.status !== '中止');
  if (items.length === 0) return '';

  const newAnswers = items.filter((c) => c.from == null);
  const changedAnswers = items.filter((c) => c.from != null);

  const parts: string[] = [];

  if (newAnswers.length > 0) {
    const report = answerReport(
      newAnswers.map((c) => ({ practice: c.practice, answer: c.to })),
    );
    if (report) parts.push(report);
  }

  if (changedAnswers.length > 0) {
    const report = answerChangeReport(
      changedAnswers.map((c) => ({ practice: c.practice, from: c.from, to: c.to })),
    );
    if (report) parts.push(report);
  }

  return parts.join('\n\n');
}
