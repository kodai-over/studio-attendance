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
import { answersSettled } from '../answering';
import { PracticeCard } from './List';
import {
  cleanupAfterCommit,
  clearGlobalDrafts,
  filterGroupPractices,
  filterTargetModifiedItems,
  generateSpecificReport,
  getModifiedItems,
  globalDrafts,
  stageAnswer,
  type ModifiedItem,
  type StageMap,
} from './answerLogic';

type RsvpSubTab = 'unanswered' | 'answered';

/** 募集カードの「回答」またはメニューの「RSVP」から開く画面。まとめて変更して、完了またはメッセージ送信で一括反映 */
export function AnswerPage({ ids: raw }: { ids: string[] }) {
  const { me, practices: list, practicesAt, startupFailed, loadHome, updatePractice, toast } = useApp();
  const ids = [...new Set(raw)];
  const isSpecific = ids.length > 0;

  // 通常表示のタブ（未回答／回答済）
  const [subTab, setSubTab] = useState<RsvpSubTab>('unanswered');

  // 下書き（ドラフト）管理: 画面切り替えで消えないよう globalDrafts と同期
  const [specificStaged, setSpecificStaged] = useState<StageMap>(() => new Map(globalDrafts.specific));
  const [unansweredStaged, setUnansweredStaged] = useState<StageMap>(() => new Map(globalDrafts.unanswered));
  const [answeredStaged, setAnsweredStaged] = useState<StageMap>(() => new Map(globalDrafts.answered));

  const [run, busy] = useRunner();
  const [saving, setSaving] = useState(false);

  // ユーザーの所属グループ一覧
  const allGroups = me.groups && me.groups.length > 0 ? me.groups : me.settings.groups || [];
  const myGroupIds = new Set(me.member.groups);
  const userGroups = allGroups.filter((g) => myGroupIds.has(g.id));

  // 所属グループ選択（'all' は廃止し、グループごとに作業）
  const [selectedGroup, setSelectedGroup] = useState<string>(() => {
    if (isSpecific && list) {
      const target = list.find((v) => ids.includes(v.practice.id));
      const matched = target?.practice.groups.find((gid) => myGroupIds.has(gid));
      if (matched) return matched;
    }
    return userGroups[0]?.id || '';
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
    if (load !== 'wait') return;
    if (practicesAt > 0) setLoad('ok');
    else if (startupFailed) setLoad('error');
  }, [practicesAt, startupFailed]);

  const fresh = load === 'ok';
  const [draft, setDraft] = useState<string | null>(null);
  const latest = useRef('');

  // 現在時刻と対象予約の判定
  const now = new Date();
  const today = toJstDate(now);
  const currentTime = toJstTime(now);

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
    : filterGroupPractices(allTargets, selectedGroup, me.member.userId);

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

  // 画面上の現在の回答（現在のタブのドラフトを反映した表示用リスト）
  const displayed = baseList.map((v) => {
    const answer = currentStaged.has(v.practice.id) ? currentStaged.get(v.practice.id)! : v.myAnswer;
    return answer !== v.myAnswer ? { ...v, myAnswer: answer } : v;
  });

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

  // 離脱防止用に最新の hasAnyChanges を保持
  const hasAnyChangesRef = useRef(false);
  hasAnyChangesRef.current = hasAnyChanges;
  const isRevertingHashRef = useRef(false);

  // ナビゲーションガード（下部メニューなどの遷移時に未保存変更があれば確認し、キャンセルなら画面遷移を阻止）
  useEffect(() => {
    setNavigationGuard(() => {
      if (hasAnyChangesRef.current) {
        if (!window.confirm('回答の変更が反映されていません。破棄して移動しますか？')) {
          return false;
        }
        hasAnyChangesRef.current = false;
        clearGlobalDrafts();
      }
      return true;
    });
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

  useEffect(() => {
    const onHashChange = (e: HashChangeEvent) => {
      if (isRevertingHashRef.current) {
        isRevertingHashRef.current = false;
        return;
      }
      if (hasAnyChangesRef.current) {
        if (!window.confirm('回答の変更が反映されていません。破棄して移動しますか？')) {
          isRevertingHashRef.current = true;
          const oldHash = new URL(e.oldURL).hash || '#/answer';
          window.location.hash = oldHash;
          setTimeout(() => {
            isRevertingHashRef.current = false;
          }, 100);
        } else {
          clearGlobalDrafts();
        }
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // 個別の回答変更（特定予約指定時は即時保存、通常画面ではドラフト更新）
  const handleStageAnswer = async (id: string, a: Answer) => {
    const original = list?.find((x) => x.practice.id === id);
    if (isSpecific) {
      setSaving(true);
      try {
        const updated = await api('rsvp', { id, answer: a });
        updatePractice(updated);
        setSpecificStaged((prev) => {
          const next = new Map(prev);
          next.set(id, a);
          return next;
        });
        toast('回答を記録しました');
      } catch (e) {
        toast(e instanceof Error ? e.message : '保存に失敗しました', true);
      } finally {
        setSaving(false);
      }
    } else {
      const key = subTab;
      const targetMap = subTab === 'unanswered' ? unansweredStaged : answeredStaged;
      const next = stageAnswer(targetMap, id, a, original ? original.myAnswer : null);
      globalDrafts[key] = next;
      setCurrentStaged(next);
    }
    setDraft(null); // 手動編集をリセットして再生成
  };

  // タブ切り替え
  const handleTabChange = (t: RsvpSubTab) => {
    setSubTab(t);
    setDraft(null);
  };

  // グループ切り替え
  const handleGroupFilterChange = (gId: string) => {
    setSelectedGroup(gId);
    setDraft(null);
  };

  // メッセージ対象の練習（選択中グループの練習。groupsが空なら全グループ対象）
  const messagePracticeFilter = (p: Pick<Practice, 'groups'>) =>
    !selectedGroup || p.groups.length === 0 || p.groups.includes(selectedGroup);

  // 表示中かつ選択グループに該当する変更項目（メッセージと件数を完全連動させる）
  const displayedIds = new Set(displayed.map((v) => v.practice.id));
  const targetModifiedItems = isSpecific
    ? modifiedItems
    : filterTargetModifiedItems(modifiedItems, displayedIds, selectedGroup, me.member.userId);
  const hasTargetChanges = targetModifiedItems.length > 0;

  // 複数件の回答保存処理（1件ずつ反映し、成功分は下書きから削除、失敗分は下書きに残して安全に再試行可能にする）
  const commitItems = async (items: ModifiedItem[]) => {
    if (items.length === 0) return { succeeded: 0, failed: 0 };
    let succeeded = 0;
    let failed = 0;
    const succeededIds: string[] = [];
    let lastError: Error | null = null;

    for (const item of items) {
      try {
        const updated = await api('rsvp', { id: item.id, answer: item.answer });
        updatePractice(updated);
        succeeded++;
        succeededIds.push(item.id);
      } catch (err) {
        failed++;
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

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
        return next;
      });
      setDraft(null); // 手動編集ドラフトをリセットして古い文の二重送信を防止
    }

    if (failed > 0) {
      if (succeeded > 0) {
        toast(`${succeeded}件反映し、${failed}件の保存に失敗しました。もう一度試してください`, true);
      } else {
        toast(`保存に失敗しました: ${lastError?.message || '通信エラー'}`, true);
      }
    }

    return { succeeded, failed };
  };

  // 送信文の生成
  let report = '';
  if (isSpecific) {
    report = generateSpecificReport(displayed, targetModifiedItems);
  } else if (subTab === 'unanswered') {
    // 未回答タブ: 「回答しました」形式（回答が入力された項目のみ）
    const activeUnanswered = displayed
      .filter((v) => v.practice.status !== '中止' && messagePracticeFilter(v.practice))
      .filter((v) => v.myAnswer != null);
    report = answerReport(activeUnanswered.map((v) => ({ practice: v.practice, answer: v.myAnswer }))) ?? '';
  } else {
    // 回答済タブ: 「回答を変更しました」形式（どういう変更をしたかを明示）
    const activeModified = targetModifiedItems.filter((item) => item.practice.status !== '中止');
    report =
      answerChangeReport(
        activeModified.map((item) => ({ practice: item.practice, from: item.originalAnswer, to: item.answer })),
      ) ?? '';
  }

  const text = draft ?? report;
  latest.current = text;
  const chat = canSendToChat();

  // 回答を反映してグループに伝える（送信先グループの変更のみ保存して送信）
  const handleTell = async () => {
    // commitItems による再レンダリングで latest.current がリセットされる前に、送信メッセージを先にキャプチャ
    const body = latest.current.trim();
    if (!body) {
      toast('送る文がありません', true);
      return;
    }
    setSaving(true);
    try {
      if (hasTargetChanges) {
        const { failed } = await commitItems(targetModifiedItems);
        if (failed > 0) return; // 失敗があった場合は送信を中断して再試行を促す
        await answersSettled();
      }
      if (chat === 'ok') {
        await sendToChat(body);
        toast('回答を反映し、グループに伝えました');
        closeApp();
      } else {
        await navigator.clipboard.writeText(body);
        toast('回答を反映し、メッセージをコピーしました');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '送信に失敗しました', true);
    } finally {
      setSaving(false);
    }
  };

  // 回答を反映して完了（選択中グループの変更があれば保存。予定画面へは切り替えずそのまま留まる）
  const handleDone = async () => {
    if (hasTargetChanges) {
      setSaving(true);
      try {
        const count = targetModifiedItems.length;
        const { succeeded, failed } = await commitItems(targetModifiedItems);
        if (failed === 0) {
          toast(`${count}件の回答を反映しました（グループには送信されていません）`);
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : '保存に失敗しました', true);
      } finally {
        setSaving(false);
      }
    }
  };

  const handleBack = () => {
    // 詳細画面からの遷移時は確実に詳細画面に戻る（LIFF内でのアプリ終了を防ぐ）
    if (ids.length === 1) {
      go(`/p/${encodeURIComponent(ids[0])}`);
    } else if (history.length > 1) {
      history.back();
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

      {hasAnyChanges && (
        <div class="rsvp-unsaved-banner">
          <Icon name="check" size={15} />
          <span>下書きがあります。「グループに伝える」または「完了」を押すまで保存されません</span>
        </div>
      )}

      {!isSpecific && (
        <>
          {/* 複数グループに所属している場合のグループ切り替え（大分類を上に配置） */}
          {userGroups.length > 1 && (
            <div class="group-filter-bar">
              {userGroups.map((g) => {
                const gCount = allTargets.filter(
                  (v) => (v.practice.groups.length === 0 || v.practice.groups.includes(g.id)) && v.myAnswer == null,
                ).length;
                return (
                  <button
                    key={g.id}
                    class={`group-pill ${selectedGroup === g.id ? 'active' : ''}`}
                    onClick={() => handleGroupFilterChange(g.id)}
                  >
                    <span>{g.name}</span>
                    {gCount > 0 && <span class="nav-badge" style={{ marginLeft: 6 }}>{gCount}</span>}
                  </button>
                );
              })}
            </div>
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
            ? '未回答の募集はありません。すべて回答済です。'
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
                disabled={!text.trim() || saving || !fresh || (!isSpecific && subTab === 'answered' && !hasTargetChanges)}
                onClick={handleTell}
              >
                <Icon name="copy" size={16} />
                {hasTargetChanges
                  ? `回答を反映してコピー（${targetModifiedItems.length}件）`
                  : !isSpecific && subTab === 'answered'
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
                  disabled={!text.trim() || saving || !fresh || (!isSpecific && subTab === 'answered' && !hasTargetChanges)}
                  onClick={handleTell}
                >
                  <Icon name="send" size={18} />
                  {hasTargetChanges
                    ? `回答を反映してグループに伝える（${targetModifiedItems.length}件）`
                    : !isSpecific && subTab === 'answered'
                    ? '回答を変更するとグループに伝えられます'
                    : 'グループに伝える'}
                </button>
                <button
                  class="btn ghost"
                  style={{ padding: '0 14px' }}
                  title="メッセージをコピー"
                  disabled={!text.trim() || saving || !fresh || (!isSpecific && subTab === 'answered' && !hasTargetChanges)}
                  onClick={async () => {
                    await navigator.clipboard.writeText(latest.current.trim());
                    toast('メッセージをコピーしました');
                  }}
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
          <button
            class={`btn ${hasTargetChanges ? 'primary' : 'ghost'} block rsvp-done-btn`}
            disabled={saving}
            onClick={handleDone}
          >
            {saving
              ? '保存中...'
              : hasTargetChanges
              ? `回答を反映して完了（${targetModifiedItems.length}件）`
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
