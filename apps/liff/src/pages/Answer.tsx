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

/** 募集カードの「回答」または下のメニュー「RSVP」から開く画面。まとめて変更して、完了またはメッセージ送信で一括反映 */
export function AnswerPage({ ids: raw }: { ids: string[] }) {
  const { me, practices: list, practicesAt, startupFailed, loadHome, updatePractice, toast } = useApp();
  const ids = [...new Set(raw)];
  const isSpecific = ids.length > 0;
  const [subTab, setSubTab] = useState<RsvpSubTab>('unanswered');
  // 画面上での変更（保存前の一時状態）。保存または送信時にまとめて反映
  const [stagedAnswers, setStagedAnswers] = useState<Map<string, Answer>>(new Map());
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

  // 所属グループ選択によるチケット絞り込み
  const groupFiltered =
    selectedGroup === 'all'
      ? allTargets
      : allTargets.filter((v) => v.practice.groups.includes(selectedGroup));

  // 未回答・回答済みの分類（タブ分類の基準は元の回答 myAnswer に固定し、回答変更してもチケットが消えないようにする）
  const todos = groupFiltered.filter((v) => v.myAnswer == null);
  const answereds = groupFiltered.filter((v) => v.myAnswer != null);
  const todoCount = todos.length;
  const answeredCount = answereds.length;
  const baseList = subTab === 'unanswered' ? todos : answereds;

  // 画面上の現在の回答（stagedAnswers を反映した表示用リスト）
  const displayed = baseList.map((v) => {
    const answer = stagedAnswers.has(v.practice.id) ? stagedAnswers.get(v.practice.id)! : v.myAnswer;
    return answer !== v.myAnswer ? { ...v, myAnswer: answer } : v;
  });

  // 変更がある項目（元の回答と下書きが異なる項目）
  const modifiedItems = Array.from(stagedAnswers.entries())
    .map(([id, answer]) => {
      const original = list?.find((x) => x.practice.id === id);
      return original && original.myAnswer !== answer
        ? { id, answer, originalAnswer: original.myAnswer, practice: original.practice }
        : null;
    })
    .filter((x): x is { id: string; answer: Answer; originalAnswer: Answer | null; practice: Practice } => x != null);
  const hasChanges = modifiedItems.length > 0;

  // 個別の回答変更（即時保存せず画面上のみ変更）
  const handleStageAnswer = (id: string, a: Answer) => {
    setStagedAnswers((prev) => {
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

  // 変更内容を一括でサーバーに送信して保存
  const commitAnswers = async () => {
    if (modifiedItems.length === 0) return;
    for (const item of modifiedItems) {
      const updated = await api('rsvp', { id: item.id, answer: item.answer });
      updatePractice(updated);
    }
    setStagedAnswers(new Map());
  };

  // 送信先グループによる絞り込み
  const effectiveTargetGroup = selectedGroup !== 'all' ? selectedGroup : targetGroup;
  const messagePracticeFilter = (p: Pick<Practice, 'groups'>) =>
    effectiveTargetGroup === 'all' || p.groups.includes(effectiveTargetGroup);

  // 送信文の生成
  let report = '';
  if (subTab === 'unanswered') {
    // 未回答タブ: 「回答しました」形式（回答が入力された項目のみ）
    const activeUnanswered = displayed
      .filter((v) => v.practice.status !== '中止' && messagePracticeFilter(v.practice))
      .filter((v) => v.myAnswer != null);
    report = answerReport(activeUnanswered.map((v) => ({ practice: v.practice, answer: v.myAnswer }))) ?? '';
  } else {
    // 回答済みタブ: 「回答を変更しました」形式（どういう変更をしたかを明示）
    const activeModified = modifiedItems.filter(
      (item) => item.practice.status !== '中止' && messagePracticeFilter(item.practice),
    );
    report =
      answerChangeReport(
        activeModified.map((item) => ({ practice: item.practice, from: item.originalAnswer, to: item.answer })),
      ) ?? '';
  }

  const text = draft ?? report;
  latest.current = text;
  const chat = canSendToChat();

  // 回答を反映してグループに伝える（一括保存してから送信）
  const handleTell = async () => {
    setSaving(true);
    try {
      if (hasChanges) {
        await commitAnswers();
        await answersSettled();
      }
      const body = latest.current.trim();
      if (!body) throw new Error('送る文がありません');
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

  // 回答を反映して完了（変更があれば保存して完了）
  const handleDone = async () => {
    if (hasChanges) {
      setSaving(true);
      try {
        const count = modifiedItems.length;
        await commitAnswers();
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
                { key: 'answered', label: '回答済み', count: list ? answeredCount : undefined },
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
            : subTab === 'unanswered'
            ? '未回答の募集はありません。すべて回答済みです！'
            : '回答済みの今後の予約情報はありません。'}
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
                disabled={!text.trim() || saving || !fresh}
                onClick={handleTell}
              >
                <Icon name="copy" size={16} />
                {hasChanges ? `回答を反映してコピー（${modifiedItems.length}件）` : '回答メッセージをコピー'}
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
                    subTab === 'unanswered'
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
                disabled={!text.trim() || saving || !fresh}
                onClick={handleTell}
              >
                <Icon name="send" size={18} />
                {hasChanges ? `回答を反映してグループに伝える（${modifiedItems.length}件）` : 'グループに伝える'}
              </button>
              <p class="note">押すと、回答が反映され、あなたの発言としてグループに送ります</p>
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
          {saving ? '保存中...' : hasChanges ? `回答を反映して完了（${modifiedItems.length}件）` : '完了'}
        </button>
      )}
    </>
  );
}
