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
import { FRESH_MS, Icon, Spinner, Syncing, Tabs, TopBar, go, useApp, useRunner } from '../ui';
import { answersSettled } from '../answering';
import { PracticeCard } from './List';

type RsvpSubTab = 'unanswered' | 'answered';

/** 募集カードの「回答」またはメニューの「RSVP」から開く画面。まとめて変更して、完了またはメッセージ送信で一括反映 */
export function AnswerPage({ ids: raw }: { ids: string[] }) {
  const { me, practices: list, practicesAt, startupFailed, loadHome, updatePractice, toast } = useApp();
  const ids = [...new Set(raw)];
  const isSpecific = ids.length > 0;

  // 特定予約の指定時は、その予約の既存回答に応じて初期タブを自動判定
  const [subTab, setSubTab] = useState<RsvpSubTab>(() => {
    if (isSpecific && list) {
      const target = list.find((v) => ids.includes(v.practice.id));
      if (target && target.myAnswer != null) return 'answered';
    }
    return 'unanswered';
  });

  // 未回答タブと回答済タブで下書き（ドラフト）を完全分離
  const [unansweredStaged, setUnansweredStaged] = useState<Map<string, Answer>>(new Map());
  const [answeredStaged, setAnsweredStaged] = useState<Map<string, Answer>>(new Map());

  const [run, busy] = useRunner();
  const [saving, setSaving] = useState(false);

  // ユーザーの所属グループ一覧
  const allGroups = me.groups && me.groups.length > 0 ? me.groups : me.settings.groups || [];
  const myGroupIds = new Set(me.member.groups);
  const userGroups = allGroups.filter((g) => myGroupIds.has(g.id));

  // 所属グループごとのチケット絞り込み（'all' またはグループID）
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  // メッセージを送るグループ（'all' またはグループID）
  const [targetGroup, setTargetGroup] = useState<string>('all');

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

  // 所属グループ選択によるチケット絞り込み（特定指定時はグループ絞り込みで消えないようにする）
  const groupFiltered =
    isSpecific || selectedGroup === 'all'
      ? allTargets
      : allTargets.filter((v) => v.practice.groups.includes(selectedGroup));

  // 未回答・回答済の分類（タブ分類の基準は元の回答 myAnswer に固定し、回答変更してもチケットが消えないようにする）
  const todos = groupFiltered.filter((v) => v.myAnswer == null);
  const answereds = groupFiltered.filter((v) => v.myAnswer != null);
  const todoCount = todos.length;
  const answeredCount = answereds.length;

  // 特定指定時は指定された全件をそのまま表示（回答済でも消えないようにする）
  const baseList = isSpecific ? allTargets : (subTab === 'unanswered' ? todos : answereds);

  // 現在のタブの判定（特定指定時は対象予約が回答済なら回答済として扱う）
  const activeTab: RsvpSubTab = isSpecific
    ? (allTargets[0]?.myAnswer != null ? 'answered' : 'unanswered')
    : subTab;

  const currentStaged = activeTab === 'unanswered' ? unansweredStaged : answeredStaged;
  const setCurrentStaged = activeTab === 'unanswered' ? setUnansweredStaged : setAnsweredStaged;

  // 画面上の現在の回答（現在のタブのドラフトを反映した表示用リスト）
  const displayed = baseList.map((v) => {
    const answer = currentStaged.has(v.practice.id) ? currentStaged.get(v.practice.id)! : v.myAnswer;
    return answer !== v.myAnswer ? { ...v, myAnswer: answer } : v;
  });

  // 現在のタブで変更がある項目
  const modifiedItems = Array.from(currentStaged.entries())
    .map(([id, answer]) => {
      const original = list?.find((x) => x.practice.id === id);
      return original && original.myAnswer !== answer
        ? { id, answer, originalAnswer: original.myAnswer, practice: original.practice }
        : null;
    })
    .filter((x): x is { id: string; answer: Answer; originalAnswer: Answer | null; practice: Practice } => x != null);
  const hasChanges = modifiedItems.length > 0;

  // 個別の回答変更（現在のタブのドラフトのみ更新）
  const handleStageAnswer = (id: string, a: Answer) => {
    setCurrentStaged((prev) => {
      const next = new Map(prev);
      const original = list?.find((x) => x.practice.id === id);
      if (original && original.myAnswer === a) {
        next.delete(id);
      } else {
        next.set(id, a);
      }
      return next;
    });
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
    if (gId !== 'all') {
      setTargetGroup(gId);
    }
    setDraft(null);
  };

  // 送信先グループによる絞り込み
  const effectiveTargetGroup = selectedGroup !== 'all' ? selectedGroup : targetGroup;
  const messagePracticeFilter = (p: Pick<Practice, 'groups'>) =>
    effectiveTargetGroup === 'all' || p.groups.includes(effectiveTargetGroup);

  // 表示中かつ送信先グループに該当する変更項目（メッセージと件数を完全連動させる）
  const displayedIds = new Set(displayed.map((v) => v.practice.id));
  const targetModifiedItems = modifiedItems.filter(
    (item) => displayedIds.has(item.id) && messagePracticeFilter(item.practice),
  );
  const hasTargetChanges = targetModifiedItems.length > 0;

  // 送信対象の変更内容のみをサーバーに送信して保存（他のグループの下書きは保持する）
  const commitTargetAnswers = async () => {
    if (targetModifiedItems.length === 0) return;
    for (const item of targetModifiedItems) {
      const updated = await api('rsvp', { id: item.id, answer: item.answer });
      updatePractice(updated);
    }
    setCurrentStaged((prev) => {
      const next = new Map(prev);
      for (const item of targetModifiedItems) {
        next.delete(item.id);
      }
      return next;
    });
  };

  // 完了時は現在のタブのすべての変更（他グループ分含む）を保存
  const commitAllAnswers = async () => {
    if (modifiedItems.length === 0) return;
    for (const item of modifiedItems) {
      const updated = await api('rsvp', { id: item.id, answer: item.answer });
      updatePractice(updated);
    }
    setCurrentStaged(new Map());
  };

  // 送信文の生成
  let report = '';
  if (activeTab === 'unanswered') {
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
    // commitTargetAnswers() による再レンダリングで latest.current がリセットされる前に、送信メッセージを先にキャプチャ
    const body = latest.current.trim();
    if (!body) {
      toast('送る文がありません', true);
      return;
    }
    setSaving(true);
    try {
      if (hasTargetChanges) {
        await commitTargetAnswers();
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

  // 回答を反映して完了（現在のタブの変更があれば保存して完了）
  const handleDone = async () => {
    if (hasChanges) {
      setSaving(true);
      try {
        const count = modifiedItems.length;
        await commitAllAnswers();
        toast(`${count}件の回答を反映しました`);
        go('/');
      } catch (e) {
        toast(e instanceof Error ? e.message : '保存に失敗しました', true);
      } finally {
        setSaving(false);
      }
    } else {
      go('/');
    }
  };

  if (list == null || (isSpecific && displayed.length < ids.length && (load === 'loading' || load === 'wait'))) {
    return (
      <>
        <TopBar title="RSVP" />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <TopBar title="RSVP">{(busy || saving || load === 'loading' || load === 'wait') && <Syncing />}</TopBar>

      {!isSpecific && (
        <>
          <header class="tabs-head" style={{ marginBottom: 10 }}>
            <Tabs
              value={subTab}
              onChange={handleTabChange}
              items={[
                { key: 'unanswered', label: '未回答', count: list ? todoCount : undefined },
                { key: 'answered', label: '回答済', count: list ? answeredCount : undefined },
              ]}
            />
          </header>

          {/* 複数グループに所属している場合のグループ切り替え */}
          {userGroups.length > 1 && (
            <div class="group-filter-bar">
              <button
                class={`group-pill ${selectedGroup === 'all' ? 'active' : ''}`}
                onClick={() => handleGroupFilterChange('all')}
              >
                <span>すべて</span>
              </button>
              {userGroups.map((g) => (
                <button
                  key={g.id}
                  class={`group-pill ${selectedGroup === g.id ? 'active' : ''}`}
                  onClick={() => handleGroupFilterChange(g.id)}
                >
                  <span>{g.name}</span>
                </button>
              ))}
            </div>
          )}
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
            : activeTab === 'unanswered'
            ? '未回答の募集はありません。すべて回答済です！'
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
        <section style={{ marginTop: 20 }}>
          <div class="sec-head">
            <Icon name="chat" size={18} />
            グループに伝える
          </div>

          {/* メッセージ送信先グループの選択（全表示かつ所属グループが複数の場合） */}
          {userGroups.length > 1 && selectedGroup === 'all' && (
            <div class="target-group-field">
              <span class="target-group-label">送り先グループ:</span>
              <select
                class="target-group-select"
                value={targetGroup}
                onChange={(e) => {
                  setTargetGroup(e.currentTarget.value);
                  setDraft(null);
                }}
                disabled={saving}
              >
                <option value="all">すべてのグループ（全体）</option>
                {userGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {chat === 'outside' ? (
            <>
              <p class="note">グループのトークから開くと、回答をまとめてグループに送信できます</p>
              <button
                class="btn ghost block"
                style={{ marginTop: 8 }}
                disabled={!text.trim() || saving || !fresh || (activeTab === 'answered' && !hasTargetChanges)}
                onClick={handleTell}
              >
                <Icon name="copy" size={16} />
                {hasTargetChanges ? `回答を反映してコピー（${targetModifiedItems.length}件）` : '回答メッセージをコピー'}
              </button>
            </>
          ) : chat === 'noScope' ? (
            <p class="note">回答は記録されます。グループに送る設定がまだのため、伝えられません（管理者に知らせてください）</p>
          ) : (
            <>
              <label class="field">
                <span>送る文（書き換えられます）</span>
                <textarea
                  class="report"
                  rows={Math.max(3, text.split('\n').length + 1)}
                  value={text}
                  placeholder={
                    activeTab === 'unanswered'
                      ? '○ △ ✕ を選ぶと、ここに文ができます'
                      : '回答を変更すると、ここに文ができます'
                  }
                  maxLength={1000}
                  onInput={(e) => setDraft(e.currentTarget.value)}
                  disabled={saving}
                />
              </label>
              {draft != null && draft !== report && (
                <button class="btn ghost block" style={{ marginBottom: 8 }} onClick={() => setDraft(null)} disabled={saving}>
                  回答から作り直す
                </button>
              )}
              <button
                class="btn primary block"
                disabled={!text.trim() || saving || !fresh || (activeTab === 'answered' && !hasTargetChanges)}
                onClick={handleTell}
              >
                <Icon name="send" size={18} />
                {hasTargetChanges ? `回答を反映してグループに伝える（${targetModifiedItems.length}件）` : 'グループに伝える'}
              </button>
              <p class="note">
                押すと、回答が反映され、あなたの発言として開いているトークに送ります。
                {userGroups.length > 1 && '（他のグループにも伝えたいときは、文をコピーしてそのトークに貼り付けてください）'}
              </p>
            </>
          )}
        </section>
      )}

      {displayed.length > 0 && (
        <button
          class={`btn ${hasChanges ? 'primary' : 'ghost'} block`}
          style={{ marginTop: 16 }}
          disabled={saving}
          onClick={handleDone}
        >
          {saving
            ? '保存中...'
            : hasChanges
            ? selectedGroup !== 'all' && modifiedItems.length > targetModifiedItems.length
              ? `回答を反映して完了（全${modifiedItems.length}件）`
              : `回答を反映して完了（${modifiedItems.length}件）`
            : '完了'}
        </button>
      )}
    </>
  );
}
