import { useState } from 'preact/hooks';
import type { AttendeeView, PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { shareLink } from '../liff';
import { Icon, Spinner, Syncing, TopBar, go, shareData, useApp } from '../ui';
import { AnswerRow, Attendees, EditForm, PracticePass, usePractice } from './Detail';
import { confirmAndRemind, resolveRecruitGroups } from './recruitLogic';

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

          {(v.practice.status === '募集中' || v.practice.status === '満員') && (
            <RecruitForm
              v={v}
              busy={busy}
              onSend={async (groups) => {
                if (me.actAs === 'test' && !confirm('確認用アカウント「admin」として、グループに募集を送ります。よろしいですか？')) return;
                await update(() => api('recruitPractice', { id, groups }), 'グループに募集を送りました');
              }}
              onRemind={async (group) => {
                await update(() => api('remindPractice', { id, group }), 'もう一度募集を送りました');
              }}
            />
          )}
        </div>

        <div class="detail-side">
          <Attendees v={v} onRemove={remove} />

          <section>
            <div class="sec-head">ゲストを追加</div>
            <GuestForm onAdd={(name) => update(() => api('addGuest', { id, name }), `${name}さんを追加しました`)} busy={busy} />
          </section>

          {v.joinUrl && <JoinLink v={v} />}

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

function GuestForm({ onAdd, busy }: { onAdd: (name: string) => Promise<unknown>; busy: boolean }) {
  const [name, setName] = useState('');
  return (
    <form
      class="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim() && (await onAdd(name.trim()))) setName('');
      }}
    >
      <input type="text" placeholder="名前" aria-label="ゲストの名前" value={name} onInput={(e) => setName(e.currentTarget.value)} maxLength={30} />
      <button class="round-btn" aria-label="ゲストを追加" disabled={busy || !name.trim()}>
        <Icon name="plus" />
      </button>
    </form>
  );
}

/** グループへの募集。いつも出し、グループがない・送れない人にはその旨を一行だけ出す */
function RecruitForm({
  v,
  onSend,
  onRemind,
  busy,
}: {
  v: PracticeView;
  onSend: (groups: string[]) => Promise<unknown>;
  onRemind: (group: string) => Promise<unknown>;
  busy: boolean;
}) {
  const { me } = useApp();
  const [picked, setPicked] = useState<string[]>([]);
  const { unrecruited: unrecruitedGroups, sent: sentGroups } = resolveRecruitGroups(
    me.groups,
    me.member.groups,
    v.practice.groups,
  );
  const myGroupsCount = (me.member.groups ?? []).length;
  const canSend = v.canEdit && unrecruitedGroups.length > 0;

  const handleRemind = async (g: { id: string; name: string }) => {
    await confirmAndRemind(g, onRemind, me.actAs === 'test');
  };

  return (
    <section>
      <div class="sec-head">グループに募集</div>
      {myGroupsCount === 0 || me.groups.length === 0 ? (
        <p class="note">Botをグループに招待すると送れます</p>
      ) : (
        <>
          {unrecruitedGroups.length > 0 && (
            <div class="chips">
              {unrecruitedGroups.map((g) => (
                <button
                  key={g.id}
                  class="chip"
                  disabled={!v.canEdit}
                  aria-pressed={picked.includes(g.id)}
                  onClick={() => setPicked(picked.includes(g.id) ? picked.filter((x) => x !== g.id) : [...picked, g.id])}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
          {!v.canEdit && <p class="note">送れるのは予約者と管理者です</p>}
          {canSend && (
            <button
              class="btn primary block section-gap"
              disabled={busy || picked.length === 0}
              onClick={async () => {
                if (await onSend(picked)) setPicked([]);
              }}
            >
              <Icon name="send" size={18} />
              {picked.length > 0 ? `${picked.length}グループに募集を送る` : '募集を送る'}
            </button>
          )}

          {sentGroups.length > 0 && v.canEdit && (
            <div class="sent-groups section-gap">
              <div class="note">募集済のグループ（もう一度募集を送る）</div>
              <div class="remind-list">
                {sentGroups.map((g) => (
                  <div key={g.id} class="remind-item">
                    <span>{g.name}</span>
                    <button
                      type="button"
                      class="btn small plain"
                      disabled={busy || v.practice.status === '満員'}
                      onClick={() => handleRemind(g)}
                    >
                      <Icon name="send" size={14} />
                      もう一度募集
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
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
      <p class="note">LINEを使わない人も、このリンクから回答できます</p>
    </section>
  );
}
