import { useState } from 'preact/hooks';
import type { AttendeeView, PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { shareLink } from '../liff';
import { Icon, Spinner, Syncing, TopBar, go, shareData, useApp } from '../ui';
import { AnswerRow, Attendees, EditForm, PracticePass, usePractice } from './Detail';
import { sendConfirmMessage, resolveRecruitGroups } from './recruitLogic';

/** 「募集」から開く練習の画面。募集先のグループ・ゲストの追加・参加リンク・（予約者と管理者は）編集と削除 */
export function RecruitDetailPage({ id }: { id: string }) {
  const { me, deletePractice } = useApp();
  const { v, loading, busy, update } = usePractice(id);
  if (!v) return <><TopBar back />{loading ? <Spinner /> : <div class="empty">予約情報が見つかりません</div>}</>;
  const remove = (a: AttendeeView) => update(() => api('removeAttendance', { id, participant: a.participant }), '削除しました');

  return (
    <>
      <TopBar back>{loading && <Syncing />}</TopBar>

      <div class="detail-layout">
        <div class="detail-primary">
          <PracticePass v={v} />

          <AnswerRow v={v} />
        </div>

        <div class="detail-side">
          <Attendees v={v} onRemove={remove} />

          <section class="guest-add">
            <GuestForm onAdd={(name) => update(() => api('addGuest', { id, name }), `${name}さんを追加しました`)} busy={busy} />
          </section>

          {v.joinUrl && <JoinLink v={v} />}

          {(v.practice.status === '募集中' || v.practice.status === '満員') && (
            <RecruitForm
              v={v}
              busy={busy}
              onRemind={async (groups) => {
                await update(() => api('remindPractice', { id, groups }), '募集を送りました');
              }}
            />
          )}

          {v.canEdit && (
            <EditForm
              v={v}
              busy={busy}
              onSave={(patch) => update(() => api('updatePractice', { id, patch }), '保存しました')}
              onDelete={async (notifyGroups) => {
                // サーバーの返事を待たずに「募集」に戻る（失敗したら一覧に戻して知らせる）
                // 一覧から来たときは戻る（履歴に削除した練習の画面を残さない）。お知らせのリンクから来たときは「募集」へ
                if (history.length > 1) history.back();
                else go('/recruit');
                await deletePractice(v, { notifyGroups });
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

/** ゲストの追加。めったに使わないので、ふだんは小さなボタンだけ。押すと名前の入力欄と×が出る。追加するか×を押すと閉じる */
function GuestForm({ onAdd, busy }: { onAdd: (name: string) => Promise<unknown>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const close = () => {
    setName('');
    setOpen(false);
  };
  if (!open) {
    return (
      <button type="button" class="btn plain small" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} />
        ゲストを追加
      </button>
    );
  }
  return (
    <form
      class="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim() && (await onAdd(name.trim()))) {
          setName('');
          setOpen(false);
        }
      }}
    >
      <input
        type="text"
        placeholder="ゲストの名前"
        aria-label="ゲストの名前"
        value={name}
        autoFocus
        onInput={(e) => setName(e.currentTarget.value)}
        // 何も入れずに離れたら、ふだんの小さなボタンに戻す
        onBlur={() => !name.trim() && close()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
        maxLength={30}
      />
      <button type="button" class="icon-btn" aria-label="ゲストの追加をやめる" onClick={close}>
        <Icon name="x" />
      </button>
      <button class="round-btn" aria-label="ゲストを追加" disabled={busy || !name.trim()}>
        <Icon name="plus" />
      </button>
    </form>
  );
}

/** グループへの募集。いつも出し、グループがない・送れない人にはその旨を一行だけ出す */
function RecruitForm({ v, onRemind, busy }: { v: PracticeView; onRemind: (groups: string[]) => Promise<unknown>; busy: boolean }) {
  const { me } = useApp();
  const { unrecruited, sent } = resolveRecruitGroups(me.groups, me.member.groups, v.practice.groups);
  // 送り先は、自分とBotが入っているグループすべて（募集済のグループを先に）。選んだグループにまとめて送る
  const groups = [...sent, ...unrecruited];
  const sentIds = new Set(sent.map((g) => g.id));
  const [picked, setPicked] = useState<string[]>(() => sent.map((g) => g.id));
  // 確認中か（アプリ内のダイアログで確かめる。端末の確認画面は、出ない環境があるため使わない）
  const [confirming, setConfirming] = useState(false);
  const chosen = groups.filter((g) => picked.includes(g.id));
  const canSend = v.canEdit && v.practice.status !== '満員' && chosen.length > 0;

  const send = async () => {
    setConfirming(false);
    await onRemind(chosen.map((g) => g.id));
  };

  return (
    <section>
      <div class="sec-head">募集を送る</div>
      {groups.length === 0 ? (
        <p class="note">Botをグループに招待すると送れます</p>
      ) : (
        <>
          <div class="chips">
            {groups.map((g) => (
              <button
                key={g.id}
                class="chip"
                disabled={!v.canEdit}
                aria-pressed={picked.includes(g.id)}
                onClick={() => setPicked(picked.includes(g.id) ? picked.filter((x) => x !== g.id) : [...picked, g.id])}
              >
                {sentIds.has(g.id) ? g.name : `${g.name}（未募集）`}
              </button>
            ))}
          </div>
          {!v.canEdit && <p class="note">送れるのは予約者と管理者です</p>}
          <button class="btn primary block section-gap-sm" disabled={busy || !canSend} onClick={() => setConfirming(true)}>
            <Icon name="send" size={18} />
            {chosen.length > 0 ? `${chosen.length}グループに募集を送る` : '募集を送る'}
          </button>
        </>
      )}

      {confirming && (
        <div class="overlay" role="dialog" aria-modal="true" aria-label="募集を送る確認">
          <div class="dialog">
            <h3>募集を送る</h3>
            <p>{sendConfirmMessage({ name: chosen.map((g) => g.name).join('・') }, me.actAs === 'test')}</p>
            <div class="btn-row">
              <button class="btn" onClick={() => setConfirming(false)}>
                キャンセル
              </button>
              <button class="btn primary" onClick={send}>
                送る
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function JoinLink({ v }: { v: PracticeView }) {
  const { toast } = useApp();
  const url = v.joinUrl!;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('参加リンクをコピーしました');
    } catch {
      prompt('参加リンク', url);
    }
  };
  const share = async () => {
    const r = await shareLink(shareData(v, url));
    if (r === 'copied') toast('参加リンクをコピーしました');
  };
  return (
    <section>
      <div class="sec-head">参加リンク</div>
      <div class="copy-row">
        <code>{url.replace(/^https?:\/\//, '')}</code>
        <button class="icon-btn" aria-label="参加リンクをコピー" onClick={copy}>
          <Icon name="copy" size={18} />
        </button>
        <button class="icon-btn" aria-label="参加リンクを共有" onClick={share}>
          <Icon name="share" size={18} />
        </button>
      </div>
    </section>
  );
}
