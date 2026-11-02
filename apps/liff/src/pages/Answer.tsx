import { useEffect, useRef, useState } from 'preact/hooks';
import { answerReport, isRsvpTarget, toJstDate, toJstTime, type Answer, type PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { canSendToChat, closeApp, sendToChat } from '../liff';
import { FRESH_MS, Icon, Spinner, Syncing, Tabs, TopBar, go, useApp, useRunner } from '../ui';
import { answersSettled } from '../answering';
import { PracticeCard, useAnswer } from './List';

type RsvpSubTab = 'todo' | 'answered';

/** 募集カードの「回答」または下のメニュー「RSVP」から開く画面。未回答や回答済みをまとめて回答・変更できる */
export function AnswerPage({ ids: raw }: { ids: string[] }) {
  const { me, practices: list, practicesAt, startupFailed, loadHome, toast } = useApp();
  const ids = [...new Set(raw)];
  const isSpecific = ids.length > 0;
  const [subTab, setSubTab] = useState<RsvpSubTab>('todo');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [run, busy] = useRunner();
  const { answer } = useAnswer();
  const [send, sending] = useRunner();

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

  // 対象となる予約情報
  let displayed: PracticeView[] = [];
  let todoCount = 0;
  let answeredCount = 0;

  if (isSpecific) {
    displayed = ids.map((id) => list?.find((v) => v.practice.id === id)).filter((v): v is PracticeView => v != null);
  } else if (list) {
    const rsvpTargets = list.filter((v) => isRsvpTarget(v, me.member.userId, me.member.groups, today, currentTime));
    const todos = rsvpTargets.filter((v) => v.myAnswer == null || v.myAnswer === '保留');
    const answereds = rsvpTargets.filter((v) => v.myAnswer === '行く' || v.myAnswer === '行かない');
    todoCount = todos.length;
    answeredCount = answereds.length;
    displayed = subTab === 'todo' ? todos : answereds;
  }

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

  // まとめて回答・変更
  const handleBulkAnswer = (a: Answer) => {
    if (selectedIds.size === 0) return;
    const targetCount = selectedIds.size;
    for (const id of selectedIds) {
      answer(id, a);
    }
    toast(`${targetCount}件を「${a === '保留' ? '未定' : a}」に変更しました`);
    setSelectedIds(new Set());
  };

  // 送信文の生成（中止の練習は除外）
  const activeDisplayed = displayed.filter((v) => v.practice.status !== '中止');
  const report = answerReport(activeDisplayed.map((v) => ({ practice: v.practice, answer: v.myAnswer }))) ?? '';
  const text = draft ?? report;
  latest.current = text;
  const chat = canSendToChat();

  const tell = () =>
    send(async () => {
      await answersSettled();
      await new Promise((r) => setTimeout(r, 0));
      const body = latest.current.trim();
      if (!body) throw new Error('送る文がありません');
      try {
        if (chat === 'ok') {
          await sendToChat(body);
          toast('グループに伝えました');
          closeApp();
        } else {
          await navigator.clipboard.writeText(body);
          toast('回答メッセージをコピーしました');
        }
      } catch (e) {
        console.error(e);
        throw new Error('メッセージの送信に失敗しました。回答は記録されています');
      }
    });

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
      <TopBar title="RSVP">{(busy || load === 'loading' || load === 'wait') && <Syncing />}</TopBar>

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
                  style={{ width: 16, height: 16, accentColor: 'var(--ink)' }}
                />
                <span>すべて選択</span>
                {selectedIds.size > 0 && <span class="muted" style={{ fontWeight: 400 }}>（{selectedIds.size}件選択中）</span>}
              </label>

              {selectedIds.size > 0 && (
                <div class="bulk-actions">
                  <button class="btn small" onClick={() => handleBulkAnswer('行く')}>
                    ○ 行く
                  </button>
                  <button class="btn small" onClick={() => handleBulkAnswer('保留')}>
                    △ 未定
                  </button>
                  <button class="btn small" onClick={() => handleBulkAnswer('行かない')}>
                    ✕ 行かない
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
                    />
                  </label>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PracticeCard
                      v={v}
                      busy={!fresh || sending}
                      onAnswer={(a) => answer(v.practice.id, a)}
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
              <p class="note">回答は記録されています。グループのトークから開くと、回答したことをそのままグループに送信できます</p>
              <button class="btn ghost block" style={{ marginTop: 8 }} disabled={!text.trim() || sending || !fresh} onClick={tell}>
                <Icon name="copy" size={16} />
                回答メッセージをコピー
              </button>
            </>
          ) : chat === 'noScope' ? (
            <p class="note">回答は記録されています。グループに送る設定がまだのため、伝えられません（管理者に知らせてください）</p>
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
                />
              </label>
              {draft != null && draft !== report && (
                <button class="btn ghost block" style={{ marginBottom: 8 }} onClick={() => setDraft(null)}>
                  回答から作り直す
                </button>
              )}
              <button class="btn primary block" disabled={!text.trim() || sending || !fresh} onClick={tell}>
                <Icon name="send" size={18} />
                グループに伝える
              </button>
              <p class="note">押すと、あなたの発言としてこのトークに送ります。伝えなくても回答は記録されています</p>
            </>
          )}
        </section>
      )}

      {displayed.length > 0 && (
        <button class="btn ghost block" style={{ marginTop: 16 }} disabled={sending} onClick={() => go('/')}>
          完了
        </button>
      )}
    </>
  );
}
