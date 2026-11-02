import { useEffect, useRef, useState } from 'preact/hooks';
import { answerReport, isRsvpTarget, toJstDate, toJstTime, type Answer, type Practice, type PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { canSendToChat, closeApp, sendToChat } from '../liff';
import { FRESH_MS, Icon, Spinner, Syncing, Tabs, TopBar, go, useApp, useRunner } from '../ui';
import { answersSettled } from '../answering';
import { PracticeCard } from './List';

type RsvpSubTab = 'todo' | 'answered';

/** 募集カードの「回答」または下のメニュー「RSVP」から開く画面。まとめて変更して、完了またはメッセージ送信で一括反映 */
export function AnswerPage({ ids: raw }: { ids: string[] }) {
  const { me, practices: list, practicesAt, startupFailed, loadHome, updatePractice, toast } = useApp();
  const ids = [...new Set(raw)];
  const isSpecific = ids.length > 0;
  const [subTab, setSubTab] = useState<RsvpSubTab>('todo');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 画面上での変更（保存前の一時状態）。保存または送信時にまとめて反映
  const [stagedAnswers, setStagedAnswers] = useState<Map<string, Answer>>(new Map());
  const [run, busy] = useRunner();
  const [saving, setSaving] = useState(false);

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

  // 対象となる予約情報（タブごとの分類は元の回答 myAnswer を基準にし、回答変更してもチケットが消えないようにする）
  let baseList: PracticeView[] = [];
  let todoCount = 0;
  let answeredCount = 0;

  if (isSpecific) {
    baseList = ids.map((id) => list?.find((v) => v.practice.id === id)).filter((v): v is PracticeView => v != null);
  } else if (list) {
    const rsvpTargets = list.filter((v) => isRsvpTarget(v, me.member.userId, me.member.groups, today, currentTime));
    const todos = rsvpTargets.filter((v) => v.myAnswer == null || v.myAnswer === '保留');
    const answereds = rsvpTargets.filter((v) => v.myAnswer === '行く' || v.myAnswer === '行かない');
    todoCount = todos.length;
    answeredCount = answereds.length;
    baseList = subTab === 'todo' ? todos : answereds;
  }

  // 画面上の現在の回答（stagedAnswers を反映した表示用リスト）
  const displayed = baseList.map((v) => {
    const answer = stagedAnswers.has(v.practice.id) ? stagedAnswers.get(v.practice.id)! : v.myAnswer;
    return answer !== v.myAnswer ? { ...v, myAnswer: answer } : v;
  });

  // 変更がある項目
  const modifiedItems = Array.from(stagedAnswers.entries())
    .map(([id, answer]) => {
      const original = list?.find((x) => x.practice.id === id);
      return original && original.myAnswer !== answer ? { id, answer, practice: original.practice } : null;
    })
    .filter((x): x is { id: string; answer: Answer; practice: Practice } => x != null);
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
  };

  // タブ切り替え時に選択をクリア
  const handleTabChange = (t: RsvpSubTab) => {
    setSubTab(t);
    setSelectedIds(new Set());
  };

  // 全選択・全解除
  const displayedIds = displayed.map((v) => v.practice.id);
  const isAllSelected = displayed.length > 0 && displayed.every((v) => selectedIds.has(v.practice.id));
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedIds));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 複数選択してまとめて回答（画面上のみ変更、チケットは移動しない）
  const handleBulkStageAnswer = (a: Answer) => {
    if (selectedIds.size === 0) return;
    setStagedAnswers((prev) => {
      const next = new Map(prev);
      for (const id of selectedIds) {
        const original = list?.find((x) => x.practice.id === id);
        if (original && original.myAnswer === a) {
          next.delete(id);
        } else {
          next.set(id, a);
        }
      }
      return next;
    });
    setSelectedIds(new Set());
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

  // 送信文の生成（下書き中の回答内容をリアルタイムに反映）
  const activeDisplayed = displayed.filter((v) => v.practice.status !== '中止');
  const report = answerReport(activeDisplayed.map((v) => ({ practice: v.practice, answer: v.myAnswer }))) ?? '';
  const text = draft ?? report;
  latest.current = text;
  const chat = canSendToChat();

  // グループに伝える（変更を一括保存してからグループへ送信）
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
        toast('出欠を更新し、グループに伝えました');
        closeApp();
      } else {
        await navigator.clipboard.writeText(body);
        toast('出欠を更新し、メッセージをコピーしました');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '送信に失敗しました', true);
    } finally {
      setSaving(false);
    }
  };

  // 完了（変更があれば保存して完了）
  const handleDone = async () => {
    if (hasChanges) {
      setSaving(true);
      try {
        const count = modifiedItems.length;
        await commitAnswers();
        toast(`${count}件の出欠を更新しました`);
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
        <header class="tabs-head" style={{ marginBottom: 12 }}>
          <Tabs
            value={subTab}
            onChange={handleTabChange}
            items={[
              { key: 'todo', label: '未回答・未定', count: list ? todoCount : undefined },
              { key: 'answered', label: '回答済み', count: list ? answeredCount : undefined },
            ]}
          />
        </header>
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
            : subTab === 'todo'
            ? '未回答や未定の募集はありません。すべて回答済みです！'
            : '回答済みの今後の予約情報はありません。'}
        </div>
      ) : (
        <>
          {displayed.length > 0 && (
            <div class="bulk-bar">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={toggleSelectAll}
                  disabled={saving}
                  style={{ width: 16, height: 16, accentColor: 'var(--ink)' }}
                />
                <span>すべて選択</span>
                {selectedIds.size > 0 && <span class="muted" style={{ fontWeight: 400 }}>（{selectedIds.size}件選択中）</span>}
              </label>

              {selectedIds.size > 0 && (
                <div class="bulk-actions">
                  <button class="btn small" disabled={saving} onClick={() => handleBulkStageAnswer('行く')}>
                    ○ まとめて行く
                  </button>
                  <button class="btn small" disabled={saving} onClick={() => handleBulkStageAnswer('保留')}>
                    △ まとめて未定
                  </button>
                  <button class="btn small" disabled={saving} onClick={() => handleBulkStageAnswer('行かない')}>
                    ✕ まとめて行かない
                  </button>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {displayed.map((v) => {
              const checked = selectedIds.has(v.practice.id);
              return (
                <div class="ticket-select-row" key={v.practice.id}>
                  <label class="ticket-select-check" aria-label={`${v.practice.date}の予約情報を選択`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(v.practice.id)}
                      disabled={saving}
                    />
                  </label>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PracticeCard
                      v={v}
                      busy={!fresh || saving}
                      onAnswer={(a) => handleStageAnswer(v.practice.id, a)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
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
          {chat === 'outside' ? (
            <>
              <p class="note">グループのトークから開くと、回答をまとめてグループに送信できます</p>
              <button class="btn ghost block" style={{ marginTop: 8 }} disabled={!text.trim() || saving || !fresh} onClick={handleTell}>
                <Icon name="copy" size={16} />
                {hasChanges ? `変更を保存してコピー（${modifiedItems.length}件）` : '回答メッセージをコピー'}
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
                  placeholder="○ △ ✕ を選ぶと、ここに文ができます"
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
              <button class="btn primary block" disabled={!text.trim() || saving || !fresh} onClick={handleTell}>
                <Icon name="send" size={18} />
                {hasChanges ? `変更を保存してグループに伝える（${modifiedItems.length}件）` : 'グループに伝える'}
              </button>
              <p class="note">押すと、出欠が保存され、あなたの発言としてこのトークに送ります</p>
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
          {saving ? '保存中...' : hasChanges ? `変更を保存して完了（${modifiedItems.length}件）` : '完了'}
        </button>
      )}
    </>
  );
}
