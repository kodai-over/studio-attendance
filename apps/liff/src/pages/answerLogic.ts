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
 * 下書きを更新する純粋関数。
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
 * 練習一覧に現在のタブ（または特定指定）の下書き回答を適用した表示用リストを生成する。
 */
export function computeDisplayedPractices(
  baseList: PracticeView[],
  currentStaged: StageMap,
): PracticeView[] {
  return baseList.map((v) => {
    const answer = currentStaged.has(v.practice.id) ? currentStaged.get(v.practice.id)! : v.myAnswer;
    return answer !== v.myAnswer ? { ...v, myAnswer: answer } : v;
  });
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
 * 複数グループ環境における下書きの所属グループ状態を判定する。
 */
export interface DraftGroupStatus {
  hasSelectedDraft: boolean;
  selectedGroupName: string;
  otherDraftGroupNames: string[];
}

export function getDraftGroupStatus(
  allModifiedItems: ModifiedItem[],
  userGroups: { id: string; name: string }[],
  selectedGroupId: string,
  myUserId?: string,
): DraftGroupStatus {
  const selectedGroup = userGroups.find((g) => g.id === selectedGroupId);
  const selectedGroupName = selectedGroup?.name ?? '選択中のグループ';

  const matchesGroup = (item: ModifiedItem, groupId: string) => {
    if (item.practice.groups.length === 0) return true;
    if (item.practice.groups.includes(groupId)) return true;
    if (myUserId && item.practice.booker === myUserId) return true;
    return false;
  };

  const hasSelectedDraft = selectedGroupId
    ? allModifiedItems.some((m) => matchesGroup(m, selectedGroupId))
    : allModifiedItems.length > 0;

  const otherDraftGroupNames = userGroups
    .filter((g) => g.id !== selectedGroupId)
    .filter((g) => allModifiedItems.some((m) => matchesGroup(m, g.id)))
    .map((g) => g.name);

  return {
    hasSelectedDraft,
    selectedGroupName,
    otherDraftGroupNames,
  };
}

/**
 * 回答保存・メッセージ送信のワークフロー。
 * 未保存の変更がある場合は先に保存を実行し、保存失敗（failed > 0）時は送信を中断する。
 */
export async function runTellWorkflow({
  body,
  hasTargetChanges,
  targetModifiedItems,
  commitItems,
  send,
}: {
  body: string;
  hasTargetChanges: boolean;
  targetModifiedItems: ModifiedItem[];
  commitItems: (items: ModifiedItem[]) => Promise<{ succeeded: number; failed: number }>;
  send: (body: string) => Promise<void>;
}): Promise<'sent' | 'aborted_by_commit_failure'> {
  if (hasTargetChanges) {
    const { failed } = await commitItems(targetModifiedItems);
    if (failed > 0) return 'aborted_by_commit_failure';
  }
  await send(body);
  return 'sent';
}

/**
 * 選択中グループに合致する予約情報を抽出する。
 * groups が空の予約情報（登録のみ等）や、自分が予約者の予約情報はどのグループ選択時にも表示する。
 * また、参加リンク回答やグループ脱退後など、所属外グループ宛でも自分が回答済みの予約情報は回答変更できるよう表示する。
 */
export function filterGroupPractices(
  practices: PracticeView[],
  selectedGroup: string,
  myUserId?: string,
  userGroupIds?: Set<string>,
): PracticeView[] {
  if (!selectedGroup) return practices;
  return practices.filter((v) => {
    if (v.practice.groups.length === 0) return true;
    if (v.practice.groups.includes(selectedGroup)) return true;
    if (myUserId && v.practice.booker === myUserId) return true;
    // 所属グループ宛ではないが回答済みの練習（参加リンク回答やグループ脱退後等）は回答変更できるよう表示
    if (v.myAnswer != null && (!userGroupIds || !v.practice.groups.some((gid) => userGroupIds.has(gid)))) {
      return true;
    }
    return false;
  });
}

/**
 * 「回答を反映して完了」のワークフロー。
 * 選択中グループの変更項目（全タブ分）を保存し、完了時のトースト文面を決定する。
 */
export async function runDoneWorkflow({
  groupAllModifiedItems,
  commitItems,
  otherDraftGroupNames,
  onSuccess,
}: {
  groupAllModifiedItems: ModifiedItem[];
  commitItems: (items: ModifiedItem[]) => Promise<{ succeeded: number; failed: number }>;
  otherDraftGroupNames: string[];
  onSuccess: (message: string) => void;
}): Promise<'saved' | 'failed' | 'noop'> {
  if (groupAllModifiedItems.length === 0) return 'noop';
  const count = groupAllModifiedItems.length;
  const { failed } = await commitItems(groupAllModifiedItems);
  if (failed > 0) return 'failed';

  const message =
    otherDraftGroupNames.length > 0
      ? `${count}件の回答を反映しました（「${otherDraftGroupNames.join('、')}」の下書きが残っています）`
      : `${count}件の回答を反映しました（グループには送信されていません）`;
  onSuccess(message);
  return 'saved';
}

/**
 * 選択中グループに合致する変更項目をフィルタリングする。
 * displayedIds が指定されている場合は表示中タブの項目に絞り込み、省略時は全タブの項目を対象とする。
 * groups が空の予約情報や自分が予約者の予約情報はどのグループ選択時にも対象に含める。
 */
export function filterTargetModifiedItems(
  modifiedItems: ModifiedItem[],
  displayedIds: Set<string> | null | undefined,
  selectedGroup: string,
  myUserId?: string,
  userGroupIds?: Set<string>,
): ModifiedItem[] {
  return modifiedItems.filter((item) => {
    if (displayedIds && !displayedIds.has(item.id)) return false;
    if (!selectedGroup || item.practice.groups.length === 0) return true;
    if (item.practice.groups.includes(selectedGroup)) return true;
    if (myUserId && item.practice.booker === myUserId) return true;
    // 所属グループ宛ではないが回答済みの練習を変更した項目も反映対象に含める
    if (item.originalAnswer != null && (!userGroupIds || !item.practice.groups.some((gid) => userGroupIds.has(gid)))) {
      return true;
    }
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

/**
 * サーバーからの一覧再取得時、回答操作中・操作済みの練習を現在の内容で保護してマージする。
 * （古いサーバー結果で、ユーザーが押した回答が「未回答」に戻るのを防止する）
 */
export function mergePracticesWithKeep(
  incoming: PracticeView[],
  current: PracticeView[] | null | undefined,
  keepIds: Set<string> | null | undefined,
): PracticeView[] {
  if (!current || !keepIds || keepIds.size === 0) return incoming;
  return incoming.map((v) => {
    if (keepIds.has(v.practice.id)) {
      return current.find((x) => x.practice.id === v.practice.id) ?? v;
    }
    return v;
  });
}

/**
 * 回答選択時の処理ワークフロー。
 * 特定予約モード（?r=）では従来どおり即時API保存＋トーストを行い、
 * 通常のメニューからの回答では下書きステートへの追加のみを行う。
 * 読み込み中や保存中（!fresh || busy || saving）は二重操作を確実にガードする。
 */
export interface StageAnswerParams {
  id: string;
  answer: Answer;
  isSpecific: boolean;
  fresh: boolean;
  busy: boolean;
  saving: boolean;
  originalPractice?: PracticeView;
  apiSave: (id: string, answer: Answer) => Promise<PracticeView>;
  touchPractice: (id: string) => void;
  updatePractice: (updated: PracticeView) => void;
  toast: (msg: string, error?: boolean) => void;
  onSpecificSaved: (updated: PracticeView, originalAnswer: Answer | null) => void;
  onDraftStaged: (originalAnswer: Answer | null) => void;
}

export async function executeStageAnswer(
  params: StageAnswerParams,
): Promise<'saved' | 'staged' | 'guarded' | 'not_found'> {
  if (!params.fresh || params.busy || params.saving) return 'guarded';
  if (!params.originalPractice) return 'not_found';

  if (params.isSpecific) {
    params.touchPractice(params.id);
    try {
      const updated = await params.apiSave(params.id, params.answer);
      params.updatePractice(updated);
      params.onSpecificSaved(updated, params.originalPractice.myAnswer);
      params.toast('回答を記録しました');
      return 'saved';
    } catch (e) {
      params.toast(e instanceof Error ? e.message : '保存に失敗しました', true);
      throw e;
    }
  } else {
    params.onDraftStaged(params.originalPractice.myAnswer);
    return 'staged';
  }
}
