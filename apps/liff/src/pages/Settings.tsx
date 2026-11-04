import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_STUDIOS, isAdmin, type ActAs, type CancelRule, type FeeDays, type FeeRule, type Member, type Role, type StudioDef } from '@studio-attendance/shared';
import { api, setActAs } from '../api';
import { getProfile, logoutApp, type UserProfile } from '../liff';
import { Avatar, Icon, Spinner, Tabs, TopBar, go, useApp, useRunner } from '../ui';
import { clearGlobalDrafts } from './answerLogic';
import { syncPracticeNotices } from './homeLogic';

const ACT_AS_LABEL: Record<ActAs, string> = { self: '自分（管理者）', member: '自分（一般）', test: '確認用アカウント「admin」' };

/** 管理者が、参加者からの見え方を確かめるための切り替え */
function ActAsSwitch() {
  const { me, setMe, setPractices, toast } = useApp();
  const [run, busy] = useRunner();
  const change = async (v: ActAs) => {
    setActAs(v);
    clearGlobalDrafts();
    const home = await run(() => api('home'));
    if (!home) return;
    syncPracticeNotices(home.practices, home.me);
    setMe(home.me);
    setPractices(home.practices, true);
    toast(`${ACT_AS_LABEL[v]}として操作します`);
  };
  return (
    <>
      <div class="sec-head">見え方の確認</div>
      <div class="chips">
        {(['self', 'member', 'test'] as ActAs[]).map((v) => (
          <button class="chip" aria-pressed={me.actAs === v} disabled={busy} onClick={() => me.actAs !== v && change(v)}>
            {ACT_AS_LABEL[v]}
          </button>
        ))}
      </div>
      <p class="note">参加者からの見え方を確かめられます。アプリを閉じると管理者に戻ります</p>
    </>
  );
}

/** アカウントページ */
export function SettingsPage() {
  const { me, setMe } = useApp();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState(me.member.name);
  const [run, busy] = useRunner();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    getProfile().then((p) => p && setProfile(p));
  }, []);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === me.member.name) {
      setEditing(false);
      return;
    }
    const m = await run(() => api('setDisplayName', { name: trimmed }), '表示名を変更しました');
    if (m) {
      setMe({ ...me, member: m });
      setEditing(false);
    }
  };

  const isBoss = isAdmin(me.member);

  return (
    <>
      <TopBar title="アカウント" showTheme />

      <section class="profile">
        {profile?.pictureUrl ? (
          <img class="profile-avatar" src={profile.pictureUrl} alt="" />
        ) : (
          <div class="profile-avatar" aria-hidden="true">
            {[...me.member.name.trim()][0] ?? '?'}
          </div>
        )}
        {editing ? (
          <form
            class="profile-edit"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input type="text" value={name} maxLength={20} aria-label="表示名" autoFocus onInput={(e) => setName(e.currentTarget.value)} />
            <button class="round-btn" aria-label="保存" disabled={busy || !name.trim()}>
              <Icon name="check" size={20} />
            </button>
          </form>
        ) : (
          <div>
            <div class="profile-name">
              <span>{me.member.name}</span>
              <button class="icon-btn" aria-label="表示名を変更" onClick={() => setEditing(true)}>
                <Icon name="edit" size={18} />
              </button>
            </div>
            <div class="profile-sub">
              <span>LINEと連携済み</span>
              {isBoss && <span class="label">管理者</span>}
            </div>
          </div>
        )}
        {editing && (
          <button
            type="button"
            class="btn plain small"
            onClick={() => {
              setName(me.member.name);
              setEditing(false);
            }}
          >
            キャンセル
          </button>
        )}
      </section>

      {isBoss && me.canSwitch && <ActAsSwitch />}

      <div class="sec-head">{isBoss ? '管理と要望' : '要望'}</div>
      <ul class="menu">
        {isBoss && (
          <li>
            <button class="menu-row" onClick={() => go('/admin')}>
              <Icon name="gear" size={22} />
              <span class="grow">管理画面</span>
              <Icon name="chevron" size={18} />
            </button>
          </li>
        )}
        <li>
          <button class="menu-row" onClick={() => go('/feedback')}>
            <Icon name="chat" size={22} />
            <span class="grow">要望を送る</span>
            <Icon name="chevron" size={18} />
          </button>
        </li>
      </ul>

      <ul class="menu section">
        <li>
          <button class="menu-row danger" onClick={() => confirm('ログアウトしますか？') && logoutApp()}>
            ログアウト
          </button>
        </li>
      </ul>
    </>
  );
}

type AdminTab = 'members' | 'studios' | 'fees';

/** 管理画面（タブ整理版） */
export function AdminPage() {
  const { me, setMe } = useApp();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [tab, setTab] = useState<AdminTab>('members');
  const [run, busy] = useRunner();
  const [studios, setStudios] = useState<StudioDef[]>(me.settings.studios);
  const [fees, setFees] = useState<FeeRule[]>(me.settings.fees);
  const setFee = (i: number, patch: Partial<FeeRule>) => setFees(fees.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const [rules, setRules] = useState<CancelRule[]>(me.settings.cancelRules);
  const [minDefault, setMinDefault] = useState(String(me.settings.minDefault));
  const [roundUnit, setRoundUnit] = useState(String(me.settings.roundUnit));

  useEffect(() => {
    run(() => api('listMembers')).then((m) => m && setMembers(m));
  }, []);

  if (!isAdmin(me.member)) {
    return (
      <>
        <TopBar title="管理画面" back />
        <div class="empty">管理者だけが使えます</div>
      </>
    );
  }

  const saveMember = async (userId: string, patch: Partial<Pick<Member, 'role' | 'defaultGroups' | 'groups'>>) => {
    const m = await run(() => api('updateMember', { userId, patch }), '保存しました');
    if (m) setMembers((ms) => ms!.map((x) => (x.userId === userId ? m : x)));
  };

  const saveSettings = async () => {
    const settings = await run(
      () => api('updateSettings', { studios, fees, cancelRules: rules, minDefault: Number(minDefault), roundUnit: Number(roundUnit) }),
      '設定を保存しました',
    );
    if (settings) {
      setMe({ ...me, settings });
      setStudios(settings.studios);
      setFees(settings.fees);
      setRules(settings.cancelRules);
    }
  };

  const tabs = [
    { key: 'members' as const, label: 'メンバー', count: members?.length },
    { key: 'studios' as const, label: 'スタジオ', count: studios.length },
    { key: 'fees' as const, label: '料金・ルール' },
  ];

  return (
    <>
      <TopBar title="管理画面" back showTheme />

      <div class="tabs-head">
        <Tabs items={tabs} value={tab} onChange={setTab} />
      </div>

      {tab === 'members' && (
        <div>
          <div class="sec-head">
            登録グループ <span class="n">{me.groups.length}</span>
          </div>
          {me.groups.length === 0 ? (
            <p class="note">Botをグループに招待すると自動で登録されます</p>
          ) : (
            <>
              <ul class="menu">
                {me.groups.map((g) => (
                  <li key={g.id}>
                    <div class="menu-row">
                      <Icon name="people" size={20} />
                      <span class="grow">{g.name}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <p class="note">グループ名はLINEのグループ名と1時間ごとにそろえます</p>
            </>
          )}

          <div class="sec-head">メンバー</div>
          <p class="note">予約情報が見えるのは、予約者・送り先のメンバー・回答者・管理者です</p>

          {members == null ? (
            <Spinner />
          ) : (
            <div class="card-grid">
              {members.map((m) => (
                <section class="card" key={m.userId}>
                  <div class="row">
                    <Avatar name={m.name} />
                    <strong class="grow ellipsis">{m.name}</strong>
                    <select
                      class="auto"
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => saveMember(m.userId, { role: e.currentTarget.value as Role })}
                    >
                      <option>一般</option>
                      <option>予約者</option>
                      <option>管理者</option>
                    </select>
                  </div>

                  {me.groups.length > 0 && (
                    <div>
                      <div class="field-label">所属（発言や予約情報を開くと自動で付きます）</div>
                      <div class="chips">
                        {me.groups.map((g) => (
                          <label key={g.id} class="chip">
                            <input
                              type="checkbox"
                              checked={m.groups.includes(g.id)}
                              disabled={busy}
                              onChange={(e) =>
                                saveMember(m.userId, {
                                  groups: e.currentTarget.checked ? [...m.groups, g.id] : m.groups.filter((x) => x !== g.id),
                                })
                              }
                            />
                            <span>{g.name}</span>
                          </label>
                        ))}
                      </div>

                      <div class="field-label">ふだんの送り先</div>
                      <div class="chips">
                        {me.groups.map((g) => (
                          <label key={g.id} class="chip">
                            <input
                              type="checkbox"
                              checked={m.defaultGroups.includes(g.id)}
                              disabled={busy}
                              onChange={(e) =>
                                saveMember(m.userId, {
                                  defaultGroups: e.currentTarget.checked
                                    ? [...m.defaultGroups, g.id]
                                    : m.defaultGroups.filter((x) => x !== g.id),
                                })
                              }
                            />
                            <span>{g.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'studios' && (
        <div>
          <StudioEditor studios={studios} onChange={setStudios} />
          <button class="btn primary block section" disabled={busy} onClick={saveSettings}>
            スタジオ・部屋の変更を保存
          </button>
        </div>
      )}

      {tab === 'fees' && (
        <div>
          <div class="sec-head">スタジオ代の料金表（30分あたり）</div>
          <p class="note">予約登録のときにスタジオ代を計算します。部屋が空欄なら全部屋、時間が空欄なら終日に使います</p>
          <div class="card-grid">
            {fees.map((f, i) => (
              <section class="card" key={i}>
                <div class="grid3">
                  <input type="text" placeholder="スタジオ" value={f.studio} onInput={(e) => setFee(i, { studio: e.currentTarget.value })} />
                  <input type="text" placeholder="部屋" value={f.room} onInput={(e) => setFee(i, { room: e.currentTarget.value })} />
                  <select value={f.days ?? ''} onChange={(e) => setFee(i, { days: e.currentTarget.value as FeeDays })}>
                    <option value="">毎日</option>
                    <option value="平日">平日</option>
                    <option value="土日祝">土日祝</option>
                  </select>
                </div>
                <div class="grid3">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="開始 17:00"
                    value={f.from ?? ''}
                    onInput={(e) => setFee(i, { from: e.currentTarget.value })}
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="終了 23:30"
                    value={f.to ?? ''}
                    onInput={(e) => setFee(i, { to: e.currentTarget.value })}
                  />
                  <input
                    type="number"
                    placeholder="円/30分"
                    value={f.fee}
                    onInput={(e) => setFee(i, { fee: Number(e.currentTarget.value) })}
                  />
                </div>
                <button class="btn small danger section-gap" onClick={() => setFees(fees.filter((_, j) => j !== i))}>
                  このルールを削除
                </button>
              </section>
            ))}
          </div>
          <button class="btn plain section-gap" onClick={() => setFees([...fees, { studio: '', room: '', days: '', from: '', to: '', fee: 0 }])}>
            <Icon name="plus" size={18} />
            料金ルールを追加
          </button>

          <div class="sec-head">キャンセル期限前のお知らせ</div>
          <p class="note">スタジオごとの無料キャンセル期限です。最低人数に届かないとき、この日時に予約者へお知らせが届きます</p>
          <section class="card">
            {rules.map((r, i) => (
              <div class="grid3" key={i}>
                <input
                  type="text"
                  placeholder="スタジオ名"
                  value={r.studio}
                  onInput={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, studio: e.currentTarget.value } : x)))}
                />
                <input
                  type="number"
                  placeholder="日前"
                  value={r.daysBefore}
                  onInput={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, daysBefore: Number(e.currentTarget.value) } : x)))}
                />
                <input
                  type="time"
                  value={r.time}
                  onInput={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, time: e.currentTarget.value } : x)))}
                />
              </div>
            ))}
            <button class="btn plain section-gap" onClick={() => setRules([...rules, { studio: '', daysBefore: 1, time: '10:00' }])}>
              <Icon name="plus" size={18} />
              キャンセルルールを追加
            </button>
          </section>

          <div class="sec-head">共通ルール</div>
          <section class="card">
            <div class="grid2">
              <label class="field">
                <span>最低人数の標準値</span>
                <input type="number" value={minDefault} onInput={(e) => setMinDefault(e.currentTarget.value)} />
              </label>
              <label class="field">
                <span>割り勘の切り上げ単位（円）</span>
                <input type="number" value={roundUnit} onInput={(e) => setRoundUnit(e.currentTarget.value)} />
              </label>
            </div>
          </section>

          <button class="btn primary block section" disabled={busy} onClick={saveSettings}>
            料金・共通ルールの変更を保存
          </button>
        </div>
      )}
    </>
  );
}

/** スタジオと部屋の一覧。スタジオ側で部屋や広さが変わったら、ここで直す（コードの変更は要らない） */
function StudioEditor({ studios, onChange }: { studios: StudioDef[]; onChange: (s: StudioDef[]) => void }) {
  const setStudio = (i: number, patch: Partial<StudioDef>) => onChange(studios.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <>
      <div class="sec-head">スタジオと部屋</div>
      <p class="note">登録しておくと、予約登録のときに部屋や広さを選べます</p>
      <ul class="menu">
        {studios.map((s, i) => (
          <li key={i}>
            <details>
              <summary class="menu-row">
                <span class="grow">{s.name || '新しいスタジオ'}</span>
                <button
                  type="button"
                  class="btn small plain danger"
                  onClick={(e) => {
                    e.preventDefault();
                    if (confirm(`${s.name}を削除しますか？`)) onChange(studios.filter((_, j) => j !== i));
                  }}
                >
                  削除
                </button>
              </summary>
              <div class="menu-item">
                <input
                  type="text"
                  placeholder="スタジオ名"
                  value={s.name}
                  onInput={(e) => setStudio(i, { name: e.currentTarget.value })}
                />
                <input
                  type="text"
                  placeholder="表記ゆれ（カンマ区切り）"
                  value={s.aliases.join(', ')}
                  onInput={(e) =>
                    setStudio(i, {
                      aliases: e.currentTarget.value
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <div class="field-label">部屋</div>
                {s.rooms.map((r, ri) => (
                  <div class="row section-gap-sm" key={ri}>
                    <input
                      type="text"
                      placeholder="部屋名（例: 202）"
                      value={r.name}
                      onInput={(e) =>
                        setStudio(i, {
                          rooms: s.rooms.map((x, j) => (j === ri ? { ...x, name: e.currentTarget.value } : x)),
                        })
                      }
                    />
                    <input
                      type="text"
                      placeholder="広さ（例: 30㎡）"
                      value={r.size}
                      onInput={(e) =>
                        setStudio(i, {
                          rooms: s.rooms.map((x, j) => (j === ri ? { ...x, size: e.currentTarget.value } : x)),
                        })
                      }
                    />
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label="この部屋を削除"
                      onClick={() =>
                        setStudio(i, {
                          rooms: s.rooms.filter((_, j) => j !== ri),
                        })
                      }
                    >
                      <Icon name="x" size={18} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  class="btn plain section-gap"
                  onClick={() =>
                    setStudio(i, {
                      rooms: [...s.rooms, { name: '', size: '' }],
                    })
                  }
                >
                  <Icon name="plus" size={18} />
                  部屋を追加
                </button>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <div class="row section-gap">
        <button class="btn plain" onClick={() => onChange([...studios, { name: '', aliases: [], rooms: [] }])}>
          <Icon name="plus" size={18} />
          スタジオを追加
        </button>
        <button
          class="btn plain"
          onClick={() =>
            confirm('スタジオと部屋の一覧を初期値に戻しますか？') &&
            onChange(DEFAULT_STUDIOS.map((s) => ({ ...s, rooms: s.rooms.map((r) => ({ ...r })) })))
          }
        >
          初期値に戻す
        </button>
      </div>
    </>
  );
}
