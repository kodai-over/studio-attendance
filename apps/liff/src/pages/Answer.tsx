import { useEffect, useRef, useState } from 'preact/hooks';
import {
  answerChangeReport,
  answerReport,
  isRsvpTarget,
  toJstDate,
  toJstTime,
  type Answer,
  type Practice,
  type PracticeView,
} from '@studio-attendance/shared';
import { api } from '../api';
import { canSendToChat, closeApp, sendToChat } from '../liff';
import { FRESH_MS, Icon, Spinner, Syncing, Tabs, TopBar, go, setNavigationGuard, useApp, useRunner } from '../ui';
import { PracticeCard } from './List';
import {
  cleanupAfterCommit,
  clearGlobalDrafts,
  computeDisplayedPractices,
  createRsvpNavigationGuard,
  executeStageAnswer,
  filterGroupPractices,
  filterTargetModifiedItems,
  generateSpecificReport,
  getDraftGroupStatus,
  getDraftOwnerKey,
  getModifiedItems,
  getUnansweredSummary,
  globalDrafts,
  mergePendingTellItems,
  processCommitItems,
  pruneStaleDrafts,
  recordSpecificChange,
  runDoneWorkflow,
  runTellWorkflow,
  saveDraftsToStorage,
  stageAnswer,
  syncDraftsForUser,
  type ModifiedItem,
  type SpecificChangeMap,
  type StageMap,
} from './answerLogic';

type RsvpSubTab = 'unanswered' | 'answered';

/** 募集カードの「回答」またはメニューの「RSVP」から開く画面。まとめて変更して、完了またはメッセージ送信でまとめて反映 */
export function AnswerPage({ ids: raw }: { ids: string[] }) {
  const { me, practices: list, practicesAt, startupFailed, loadHome, updatePractice, touchPractice, untouchPractice, toast } = useApp();
  const ids = [...new Set(raw)];
  const isSpecific = ids.length > 0;
  const draftOwnerKey = getDraftOwnerKey(me);

  // 通常表示のタブ（未回答／回答済）
  const [subTab, setSubTab] = useState<RsvpSubTab>('unanswered');

  // 下書き管理: ユーザーIDごとに同期し、画面切り替えで消えないよう globalDrafts と同期
  const [specificStaged, setSpecificStaged] = useState<StageMap>(() => {
    syncDraftsForUser(draftOwnerKey);
    return new Map(globalDrafts.specific);
  });
  const [unansweredStaged, setUnansweredStaged] = useState<StageMap>(() => new Map(globalDrafts.unanswered));
  const [answeredStaged, setAnsweredStaged] = useState<StageMap>(() => new Map(globalDrafts.answered));

  // 特定予約指定時の変更履歴（即時保存された変更を送信文生成に使う）
  const [specificChanges, setSpecificChanges] = useState<SpecificChangeMap>(new Map());

  // 「グループに伝える」実行中に一部保存成功して送信中断された項目（再試行時に文面から欠けないよう保持）
  const [pendingTellItems, setPendingTellItems] = useState<ModifiedItem[]>([]);

  const [run, busy] = useRunner();
  const [saving, setSaving] = useState(false);

  // 現在時刻と未回答サマリーの判定
  const now = new Date();
  const today = toJstDate(now);
  const currentTime = toJstTime(now);
  const unansweredSummary = getUnansweredSummary(list, me, today, currentTime);

  // ユーザーの所属グループ一覧
  const allGroups = me.groups && me.groups.length > 0 ? me.groups : me.settings.groups || [];
  const myGroupIds = new Set(me.member.groups);
  const userGroups = allGroups.filter((g) => myGroupIds.has(g.id));

  // 所属グループ選択（'all' は廃止し、グループごとに作業。通常表示時は未回答がある最初のグループを優先選択）
  const [selectedGroup, setSelectedGroup] = useState<string>(() => {
    if (isSpecific && list) {
      const target = list.find((v) => ids.includes(v.practice.id));
      const matched = target?.practice.groups.find((gid) => myGroupIds.has(gid));
      if (matched) return matched;
    }
    return unansweredSummary.initialGroupId || userGroups[0]?.id || '';
  });

  // 最新の一覧を取り終えたか。前回の表示の回答のまま送らないよう、取れるまでは答えも送信も止める。
  const [load, setLoad] = useState<'wait' | 'loading' | 'ok' | 'error'>(() =>
    practicesAt > 0 && Date.now() - practicesAt < FRESH_MS ? 'ok' : practicesAt === 0 && !startupFailed ? 'wait' : 'loading',
  );

  const reload = () => {
    setLoad('loading');
    run(() => loadHome().then(() => true)).then((r) => setLoad(r ? 'ok' : 'error'));
  };

  useEffect(() => {
    if (load === 'loading') reload();
  }, []);

  useEffect(() => {
    syncDraftsForUser(draftOwnerKey);
    if (list) {
      pruneStaleDrafts(list);
    }
    setSpecificStaged(new Map(globalDrafts.specific));
    setUnansweredStaged(new Map(globalDrafts.unanswered));
    setAnsweredStaged(new Map(globalDrafts.answered));
  }, [draftOwnerKey, list]);

  useEffect(() => {
    if (load !== 'wait') return;
    if (practicesAt > 0) setLoad('ok');
    else if (startupFailed) setLoad('error');
  }, [practicesAt, startupFailed]);

  const fresh = load === 'ok';
  const [draft, setDraft] = useState<string | null>(null);
  const latest = useRef('');

  // 対象となる予約情報全体
  let allTargets: PracticeView[] = [];
  if (isSpecific) {
    allTargets = ids.map((id) => list?.find((v) => v.practice.id === id)).filter((v): v is PracticeView => v != null);
  } else if (list) {
    allTargets = list.filter((v) => isRsvpTarget(v, me.member.userId, me.member.groups, today, currentTime));
  }

  // 所属グループ選択によるチケット絞り込み（groupsが空の予約情報や自分が予約者の予約情報は全グループで表示）
  const groupFiltered = isSpecific
    ? allTargets
    : filterGroupPractices(allTargets, selectedGroup, me.member.userId, myGroupIds);

  // 未回答・回答済の分類（タブ分類の基準は元の回答 myAnswer に固定し、回答変更してもチケットが消えないようにする）
  const todos = groupFiltered.filter((v) => v.myAnswer == null);
  const answereds = groupFiltered.filter((v) => v.myAnswer != null);
  const todoCount = todos.length;
  const answeredCount = answereds.length;

  // 表示する予約リスト
  const baseList = isSpecific ? allTargets : (subTab === 'unanswered' ? todos : answereds);

  // 現在使用する下書きステート
  const currentStaged = isSpecific
    ? specificStaged
    : subTab === 'unanswered'
    ? unansweredStaged
    : answeredStaged;
  const setCurrentStaged = isSpecific
    ? setSpecificStaged
    : subTab === 'unanswered'
    ? setUnansweredStaged
    : setAnsweredStaged;

  // 画面上の現在の回答（現在のタブの下書きを反映した表示用リスト）
  const displayed = computeDisplayedPractices(baseList, currentStaged);

  // 現在のタブで変更がある項目
  const modifiedItems = getModifiedItems(currentStaged, list);
  const hasChanges = modifiedItems.length > 0;

  // 全タブの変更項目一覧（離脱防止と一括完了保存に使用）
  const allModifiedItems = isSpecific
    ? modifiedItems
    : [
        ...getModifiedItems(unansweredStaged, list),
        ...getModifiedItems(answeredStaged, list),
      ];
  const hasAnyChanges = allModifiedItems.length > 0;

  // 所属グループ全体の下書き状態（複数グループ所属時のバナー文・完了後案内に使用）
  const draftGroupStatus = getDraftGroupStatus(
    allModifiedItems,
    userGroups,
    selectedGroup,
    me.member.userId,
  );

  // 離脱防止用に最新の hasAnyChanges を保持
  const hasAnyChangesRef = useRef(false);
  hasAnyChangesRef.current = hasAnyChanges;

  // 素早い連続タップによる二重保存を同期的に防ぐためのフラグ
  const isOperatingRef = useRef(false);

  // ナビゲーションガード（下部メニューや戻るなどの遷移時に未保存変更があれば確認し、キャンセルなら画面遷移を阻止）
  useEffect(() => {
    setNavigationGuard(createRsvpNavigationGuard(hasAnyChangesRef));
    return () => setNavigationGuard(null);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasAnyChangesRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // 個別の回答変更（特定予約指定時は即時保存、通常画面では下書き更新）
  const handleStageAnswer = async (id: string, a: Answer) => {
    if (isOperatingRef.current || !fresh || busy || saving) return;
    isOperatingRef.current = true;
    const original = list?.find((x) => x.practice.id === id);
    if (isSpecific) setSaving(true);
    try {
      const outcome = await executeStageAnswer({
        id,
        answer: a,
        isSpecific,
        fresh,
        busy,
        saving,
        originalPractice: original,
        apiSave: (pId, pAnswer) => api('rsvp', { id: pId, answer: pAnswer }),
        touchPractice,
        untouchPractice,
        updatePractice,
        toast,
        onSpecificSaved: (updated, originalAnswer) => {
          setSpecificChanges((prev) =>
            recordSpecificChange(prev, updated.practice, originalAnswer, a),
          );
          setSpecificStaged((prev) => {
            const next = new Map(prev);
            next.set(id, a);
            return next;
          });
        },
        onDraftStaged: (originalAnswer) => {
          const key = subTab;
          const targetMap = subTab === 'unanswered' ? unansweredStaged : answeredStaged;
          const next = stageAnswer(targetMap, id, a, originalAnswer);
          globalDrafts[key] = next;
          saveDraftsToStorage(draftOwnerKey);
          setCurrentStaged(next);
        },
      });
      if (outcome === 'saved' || outcome === 'staged') {
        setDraft(null); // 手動編集をリセットして再生成
      }
    } catch {
      /* トースト通知済み */
    } finally {
      isOperatingRef.current = false;
      if (isSpecific) setSaving(false);
    }
  };

  // タブ切り替え
  const handleTabChange = (t: RsvpSubTab) => {
    setSubTab(t);
    setPendingTellItems([]);
    setDraft(null);
  };

  // グループ切り替え
  const handleGroupFilterChange = (gId: string) => {
    setSelectedGroup(gId);
    setPendingTellItems([]);
    setDraft(null);
  };

  // 表示中かつ選択グループに該当する変更項目（メッセージと件数を完全連動させる）
  const displayedIds = new Set(displayed.map((v) => v.practice.id));
  const targetModifiedItems = isSpecific
    ? modifiedItems
    : filterTargetModifiedItems(modifiedItems, displayedIds, selectedGroup, me.member.userId, myGroupIds);
  const hasTargetChanges = targetModifiedItems.length > 0;
  const reportModifiedItems = mergePendingTellItems(pendingTellItems, targetModifiedItems);
  const hasReportableChanges = reportModifiedItems.length > 0;

  // 選択中グループに属する全タブの変更項目（「完了」ボタンでまとめて保存する対象）
  const groupAllModifiedItems = isSpecific
    ? modifiedItems
    : filterTargetModifiedItems(allModifiedItems, null, selectedGroup, me.member.userId, myGroupIds);
  const hasGroupAllChanges = groupAllModifiedItems.length > 0;

  // 複数件の回答保存処理（1件ずつ反映し、成功分は下書きから削除、失敗分は下書きに残して安全に再試行可能にする）
  const commitItems = async (items: ModifiedItem[]) => {
    if (items.length === 0) return { succeeded: 0, failed: 0, succeededIds: [] as string[] };
    const { succeeded, failed, succeededIds, lastError } = await processCommitItems(
      items,
      async (item) => {
        touchPractice(item.id);
        try {
          const updated = await api('rsvp', { id: item.id, answer: item.answer });
          updatePractice(updated);
        } catch (err) {
          untouchPractice?.(item.id);
          throw err;
        }
      },
    );

    if (succeededIds.length > 0) {
      setSpecificStaged((prev) => {
        const next = cleanupAfterCommit(prev, succeededIds);
        globalDrafts.specific = next;
        return next;
      });
      setUnansweredStaged((prev) => {
        const next = cleanupAfterCommit(prev, succeededIds);
        globalDrafts.unanswered = next;
        return next;
      });
      setAnsweredStaged((prev) => {
        const next = cleanupAfterCommit(prev, succeededIds);
        globalDrafts.answered = next;
        saveDraftsToStorage(draftOwnerKey);
        return next;
      });
      if (failed === 0) {
        setDraft(null); // 全件成功時のみ手動編集した文面をリセット（失敗で中断時は編集内容を保持）
      }
    }

    if (failed > 0) {
      if (succeeded > 0) {
        toast(`${succeeded}件反映し、${failed}件の保存に失敗しました。もう一度試してください`, true);
      } else {
        toast(`保存に失敗しました: ${lastError?.message || '通信エラー'}`, true);
      }
    }

    return { succeeded, failed, succeededIds };
  };

  // 送信文の生成（一部保存成功後に中断した pendingTellItems も統合して再試行時に欠けないようにする）
  let report = '';
  if (isSpecific) {
    if (specificChanges.size > 0) {
      report = generateSpecificReport(specificChanges.values());
    } else {
      // 変更操作がない場合（既に回答済みの人が開き直した場合など）は、現在の回答から文を生成
      const answeredItems = displayed.filter((v) => v.practice.status !== '中止' && v.myAnswer != null);
      if (answeredItems.length > 0) {
        report = answerReport(answeredItems.map((v) => ({ practice: v.practice, answer: v.myAnswer }))) ?? '';
      }
    }
  } else if (subTab === 'unanswered') {
    // 未回答タブ: 「回答しました」形式（回答が入力された項目のみ。reportModifiedItems に揃える）
    const activeUnanswered = reportModifiedItems.filter((item) => item.practice.status !== '中止');
    report = answerReport(activeUnanswered.map((item) => ({ practice: item.practice, answer: item.answer }))) ?? '';
  } else {
    // 回答済タブ: 「回答を変更しました」形式（どういう変更をしたかを明示）
    const activeModified = reportModifiedItems.filter((item) => item.practice.status !== '中止');
    report =
      answerChangeReport(
        activeModified.map((item) => ({ practice: item.practice, from: item.originalAnswer, to: item.answer })),
      ) ?? '';
  }

  const text = draft ?? report;
  latest.current = text;
  const chat = canSendToChat();

  // 回答を反映してグループに伝える・またはコピーする（未反映の下書きがある場合は必ず先に保存してから実行）
  const handleTell = async (mode: 'send' | 'copy' = 'send') => {
    // commitItems による再レンダリングで latest.current がリセットされる前に、送信メッセージを先にキャプチャ
    const body = latest.current.trim();
    if (!body) {
      toast('送る文がありません', true);
      return;
    }
    const hadChanges = hasTargetChanges;
    setSaving(true);
    try {
      const outcome = await runTellWorkflow({
        body,
        hasTargetChanges,
        targetModifiedItems,
        commitItems,
        send: async (msg) => {
          if (mode === 'send' && chat === 'ok') {
            await sendToChat(msg);
            toast(isSpecific || !hadChanges ? 'グループに伝えました' : '回答を反映し、グループに伝えました');
            closeApp();
          } else {
            await navigator.clipboard.writeText(msg);
            toast(isSpecific || !hadChanges ? 'メッセージをコピーしました' : '回答を反映し、メッセージをコピーしました');
          }
        },
        onPreserveDraft: (preserved) => setDraft(preserved),
        onPartialCommit: (succeededItems) => {
          setPendingTellItems((prev) => mergePendingTellItems(prev, succeededItems));
        },
        onSent: () => {
          setPendingTellItems([]);
          setDraft(null);
        },
      });
      if (outcome === 'aborted_by_commit_failure') {
        return; // 失敗があった場合は送信・コピーを中断して再試行を促す
      }
    } catch (e) {
      // 送信（またはクリップボードコピー）に失敗した場合、body を下書きとして復元して再送可能にする
      setDraft(body);
      toast(e instanceof Error ? e.message : mode === 'copy' ? 'メッセージのコピーに失敗しました' : '送信に失敗しました', true);
    } finally {
      setSaving(false);
    }
  };

  // 回答を反映して完了（選択中グループの全タブの変更をまとめて保存。予定画面へは切り替えずそのまま留まる）
  const handleDone = async () => {
    if (hasGroupAllChanges) {
      setSaving(true);
      try {
        await runDoneWorkflow({
          groupAllModifiedItems,
          commitItems,
          otherDraftGroupNames: draftGroupStatus.otherDraftGroupNames,
          onSuccess: (msg) => {
            setPendingTellItems([]);
            toast(msg);
          },
        });
      } catch (e) {
        toast(e instanceof Error ? e.message : '保存に失敗しました', true);
      } finally {
        setSaving(false);
      }
    }
  };

  const handleBack = () => {
    // 履歴があるときは history.back() を優先し、ないとき（直接URLを開いた場合等）だけ詳細画面またはトップへ戻る
    if (history.length > 1) {
      history.back();
    } else if (ids.length === 1) {
      go(`/p/${encodeURIComponent(ids[0])}`);
    } else {
      go('/');
    }
  };

  if (list == null || (isSpecific && displayed.length < ids.length && (load === 'loading' || load === 'wait'))) {
    return (
      <>
        <TopBar title="RSVP" back={isSpecific} onBack={handleBack} />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <TopBar title="RSVP" back={isSpecific} onBack={handleBack}>
        {(busy || saving || load === 'loading' || load === 'wait') && <Syncing />}
      </TopBar>

      {!isSpecific && hasAnyChanges && (
        <div class="rsvp-unsaved-banner">
          <Icon name="check" size={15} />
          <span>
            {draftGroupStatus.hasSelectedDraft
              ? userGroups.length > 1
                ? `「${draftGroupStatus.selectedGroupName}」の下書きがあります。「グループに伝える」または「完了」を押すまで保存されません`
                : '下書きがあります。「グループに伝える」または「完了」を押すまで保存されません'
              : `他グループ（${draftGroupStatus.otherDraftGroupNames.join('、')}）に未反映の下書きがあります`}
          </span>
        </div>
      )}

      {!isSpecific && (
        <>
          {/* 複数グループに所属している場合のグループ切り替え（下部メニューバッジとの対応が分かるようグループ別未回答件数を表示） */}
          {userGroups.length > 1 && (
            <>
              <div class="group-filter-bar">
                {unansweredSummary.groups.map((g) => (
                  <button
                    key={g.id}
                    class={`group-pill ${selectedGroup === g.id ? 'active' : ''}`}
                    onClick={() => handleGroupFilterChange(g.id)}
                  >
                    <span>{g.name}</span>
                    <span class="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                      未回答{g.unansweredCount}
                    </span>
                    {g.unansweredCount > 0 && <span class="nav-badge" style={{ marginLeft: 4 }}>{g.unansweredCount}</span>}
                  </button>
                ))}
              </div>
              {unansweredSummary.totalCount > 0 && (
                <p class="note" style={{ margin: '0 0 8px', fontSize: 12 }}>
                  未回答 合計 {unansweredSummary.totalCount}件（
                  {unansweredSummary.groups.map((g) => `${g.name}: ${g.unansweredCount}件`).join(' / ')}）
                </p>
              )}
            </>
          )}

          <header class="tabs-head" style={{ marginBottom: 12 }}>
            <Tabs
              value={subTab}
              onChange={handleTabChange}
              items={[
                { key: 'unanswered', label: '未回答', count: list ? todoCount : undefined },
                { key: 'answered', label: '回答済', count: list ? answeredCount : undefined },
              ]}
            />
          </header>
        </>
      )}

      {load === 'error' && (
        <div class="empty">
          最新の回答を読み込めませんでした
          <button class="btn primary" onClick={reload}>
            読み込み直す
          </button>
        </div>
      )}

      {load !== 'error' && displayed.length === 0 ? (
        <div class="empty">
          {isSpecific
            ? '予約情報が見つかりません（終了した・削除された・見られない予約情報です）'
            : subTab === 'unanswered'
            ? userGroups.length > 1 && unansweredSummary.totalCount > 0
              ? 'このグループの未回答の募集はありません（他のグループに未回答の募集があります）'
              : '未回答の募集はありません。すべて回答済です。'
            : '回答済の今後の予約情報はありません。'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {displayed.map((v) => (
            <PracticeCard
              key={v.practice.id}
              v={v}
              busy={!fresh || saving}
              onAnswer={(a) => handleStageAnswer(v.practice.id, a)}
            />
          ))}
        </div>
      )}

      {isSpecific && displayed.length > 0 && displayed.length < ids.length && (
        <p class="note">終了した・削除された・見られない予約情報は表示していません</p>
      )}

      {fresh && displayed.length > 0 && (
        <section class="rsvp-tell-section">
          <div class="sec-head">
            <Icon name="chat" size={18} />
            グループに伝える
          </div>

          {chat === 'outside' ? (
            <>
              <p class="note" style={{ lineHeight: 1.5 }}>
                グループのトークから開くと、回答をまとめてグループに伝えられます
              </p>
              <button
                class="btn ghost block"
                style={{ marginTop: 14 }}
                disabled={!text.trim() || saving || !fresh || (!isSpecific && subTab === 'answered' && !hasReportableChanges)}
                onClick={() => handleTell('copy')}
              >
                <Icon name="copy" size={16} />
                {hasTargetChanges
                  ? `回答を反映してコピー（${targetModifiedItems.length}件）`
                  : !isSpecific && subTab === 'answered' && !hasReportableChanges
                  ? '回答を変更するとコピーできます'
                  : '回答メッセージをコピー'}
              </button>
            </>
          ) : chat === 'noScope' ? (
            <p class="note" style={{ lineHeight: 1.5 }}>
              回答は記録されます。グループに送る設定がまだのため、伝えられません（管理者に知らせてください）
            </p>
          ) : (
            <>
              <label class="field">
                <span>送る文（書き換えられます）</span>
                <textarea
                  class="report"
                  rows={Math.max(3, text.split('\n').length + 1)}
                  value={text}
                  placeholder={
                    isSpecific
                      ? '○ △ ✕ を選ぶと、ここに文ができます'
                      : subTab === 'unanswered'
                      ? '○ △ ✕ を選ぶと、ここに文ができます'
                      : '回答を変更すると、ここに文ができます'
                  }
                  maxLength={1000}
                  onInput={(e) => setDraft(e.currentTarget.value)}
                  disabled={saving}
                />
              </label>
              {draft != null && draft !== report && (
                <button class="btn ghost block" style={{ marginBottom: 12 }} onClick={() => setDraft(null)} disabled={saving}>
                  回答から作り直す
                </button>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  class="btn primary"
                  style={{ flex: 1 }}
                  disabled={!text.trim() || saving || !fresh || (!isSpecific && subTab === 'answered' && !hasReportableChanges)}
                  onClick={() => handleTell('send')}
                >
                  <Icon name="send" size={18} />
                  {hasTargetChanges
                    ? `回答を反映してグループに伝える（${targetModifiedItems.length}件）`
                    : !isSpecific && subTab === 'answered' && !hasReportableChanges
                    ? '回答を変更するとグループに伝えられます'
                    : 'グループに伝える'}
                </button>
                <button
                  class="btn ghost"
                  style={{ padding: '0 14px' }}
                  title={hasTargetChanges ? '回答を反映してメッセージをコピー' : 'メッセージをコピー'}
                  aria-label={hasTargetChanges ? '回答を反映してメッセージをコピー' : 'メッセージをコピー'}
                  disabled={!text.trim() || saving || !fresh || (!isSpecific && subTab === 'answered' && !hasReportableChanges)}
                  onClick={() => handleTell('copy')}
                >
                  <Icon name="copy" size={18} />
                </button>
              </div>
              <p class="note rsvp-tell-note">
                押すと、回答が反映され、あなたの発言として開いているトークに送ります。
                {userGroups.length > 1 &&
                  '（他のグループへ伝えたいときは、上のグループを切り替えて文をコピーし、そのトークに貼り付けてください）'}
              </p>
            </>
          )}
        </section>
      )}

      {!isSpecific && displayed.length > 0 && (
        <>
          {hasGroupAllChanges && (
            <p class="note" style={{ textAlign: 'center', marginBottom: 8, color: 'var(--color-primary, #2563eb)', fontWeight: 600 }}>
              ※まだ保存されていません。「完了」または「グループに伝える」を押して回答を反映してください
            </p>
          )}
          <button
            class={`btn ${hasGroupAllChanges ? 'primary' : 'ghost'} block rsvp-done-btn`}
            disabled={saving}
            onClick={handleDone}
          >
            {saving
              ? '保存中...'
              : hasGroupAllChanges
              ? `回答を反映して完了（${groupAllModifiedItems.length}件）`
              : '完了'}
          </button>
          <p class="note rsvp-tell-note" style={{ textAlign: 'center', marginTop: 8 }}>
            ※「完了」は回答の保存のみ行います。グループへ知らせたいときは「グループに伝える」を押してください。
          </p>
        </>
      )}
    </>
  );
}
