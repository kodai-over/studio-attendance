import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_STUDIOS, isAdmin, type ActAs, type CancelRule, type FeeDays, type FeeRule, type Member, type Role, type StudioDef } from '@studio-attendance/shared';
import { api, setActAs } from '../api';
import { getProfile, logoutApp, type UserProfile } from '../liff';
import { Avatar, Icon, Spinner, Tabs, TopBar, go, useApp, useRunner } from '../ui';

const ACT_AS_LABEL: Record<ActAs, string> = { self: '自分（管理者）', member: '自分（一般）', test: '確認用アカウント「admin」' };

/** 管理者が、参加者からの見え方を確かめるための切り替え */
function ActAsSwitch() {
  const { me, setMe, setPractices, toast } = useApp();
  const [run, busy] = useRunner();
  const change = async (v: ActAs) => {
    setActAs(v);
    const home = await run(() => api('home'));
    if (!home) return;
    setMe(home.me);
    setPractices(home.practices, true);
    toast(`${ACT_AS_LABEL[v]}として操作します`);
  };
  return (
    <>
      <div class="section-title">見え方の確認</div>
      <section class="card">
        <div class="muted" style={{ marginBottom: 8, fontSize: 12 }}>
          「一般」では所属グループの予約情報のみ表示。「admin」（予約者）で予約情報を登録・募集し、自分に切り替えることで参加者からの見え方をテストできます。アプリを閉じると管理者に戻ります。
        </div>
        <div class="toggles">
          {(['self', 'member', 'test'] as ActAs[]).map((v) => (
            <button class="toggle" aria-pressed={me.actAs === v} disabled={busy} onClick={() => me.actAs !== v && change(v)}>
              {ACT_AS_LABEL[v]}
            </button>
          ))}
        </div>
      </section>
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

      {/* プロフィールカード（添付画像スタイル） */}
      <section class="account-card">
        <div class="account-avatar-wrap">
          {profile?.pictureUrl ? (
            <img class="account-avatar-img" src={profile.pictureUrl} alt={me.member.name} />
          ) : (
            <div class="account-avatar-fallback">
              {[...me.member.name.trim()][0] ?? '?'}
            </div>
          )}
        </div>
        <div class="account-details">
          {editing ? (
            <form
              class="account-edit-form"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <input
                type="text"
                value={name}
                maxLength={20}
                aria-label="表示名"
                autoFocus
                onInput={(e) => setName(e.currentTarget.value)}
              />
              <button class="account-icon-btn check" aria-label="保存" disabled={busy || !name.trim()}>
                <Icon name="check" size={16} />
              </button>
              <button
                type="button"
                class="account-icon-btn cancel"
                aria-label="キャンセル"
                onClick={() => {
                  setName(me.member.name);
                  setEditing(false);
                }}
              >
                <Icon name="x" size={16} />
              </button>
            </form>
          ) : (
            <div class="account-name-row">
              <span class="account-name">{me.member.name}</span>
              <button class="account-edit-trigger" aria-label="表示名を変更" onClick={() => setEditing(true)}>
                <Icon name="edit" size={15} />
              </button>
            </div>
          )}
          <div class="account-status-badge">
            <span class="check-dot">✓</span>
            <span>LINEアカウント連携済み</span>
            {isBoss && <span class="role-pill">管理者</span>}
          </div>
        </div>
      </section>

      {/* 管理者のみ表示 */}
      {isBoss && (
        <>
          {me.canSwitch && <ActAsSwitch />}

          <div class="section-title">管理</div>
          <ul class="menu" style={{ marginTop: 8 }}>
            <li>
              <button class="menu-row" onClick={() => go('/admin')}>
                <Icon name="gear" size={20} />
                <span class="grow">管理画面</span>
                <span class="val">グループ・メンバー・スタジオ・料金</span>
                <Icon name="chevron" size={18} />
              </button>
            </li>
          </ul>
        </>
      )}

      {/* ログアウトボタン（添付画像スタイル） */}
      <div class="account-logout-section">
        <button class="account-logout-btn" onClick={() => confirm('ログアウトしますか？') && logoutApp()}>
          <Icon name="logout" size={18} />
          <span>ログアウト</span>
        </button>
      </div>
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
    { key: 'members' as const, label: 'メンバー・グループ', count: members?.length },
    { key: 'studios' as const, label: 'スタジオ・部屋', count: studios.length },
    { key: 'fees' as const, label: '料金・共通ルール' },
  ];

  return (
    <>
      <TopBar title="管理画面" back showTheme />

      <Tabs items={tabs} value={tab} onChange={setTab} />

      {tab === 'members' && (
        <div class="admin-tab-pane">
          <div class="section-title">登録グループ（{me.groups.length}）</div>
          <section class="card">
            {me.groups.length === 0 ? (
              <div class="muted">Botをグループに招待すると自動で登録されます</div>
            ) : (
              <div class="admin-groups-list">
                {me.groups.map((g) => (
                  <div key={g.id} class="admin-group-item">
                    <Icon name="people" size={16} />
                    <strong>{g.name}</strong>
                  </div>
                ))}
              </div>
            )}
            <div class="muted" style={{ marginTop: 8, fontSize: 11 }}>
              ※ グループ名はLINEのグループ名に1時間ごとに自動同期されます
            </div>
          </section>

          <div class="section-title">メンバー一覧</div>
          <div class="muted" style={{ marginBottom: 10, fontSize: 12 }}>
            予約情報が見えるのは、予約者・送り先グループのメンバー・回答者・管理者です。
          </div>

          {members == null ? (
            <Spinner />
          ) : (
            <div class="card-grid">
              {members.map((m) => (
                <section class="card admin-member-card" key={m.userId}>
                  <div class="row" style={{ alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                      <Avatar name={m.name} />
                      <strong class="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.name}
                      </strong>
                    </div>
                    <select
                      style={{ width: 'auto', minWidth: 90 }}
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
                    <div class="admin-member-groups" style={{ marginTop: 10 }}>
                      <div class="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                        所属グループ（発言や予約閲覧で自動付与）:
                      </div>
                      <div class="check-chips">
                        {me.groups.map((g) => (
                          <label key={g.id} class="check-chip">
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

                      <div class="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 4 }}>
                        ふだんの送り先:
                      </div>
                      <div class="check-chips">
                        {me.groups.map((g) => (
                          <label key={g.id} class="check-chip">
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
        <div class="admin-tab-pane">
          <StudioEditor studios={studios} onChange={setStudios} />
          <button class="btn primary block" style={{ marginTop: 20 }} disabled={busy} onClick={saveSettings}>
            スタジオ・部屋の変更を保存
          </button>
        </div>
      )}

      {tab === 'fees' && (
        <div class="admin-tab-pane">
          <div class="section-title">スタジオ代の料金表（30分あたり）</div>
          <section class="card">
            <div class="muted" style={{ marginBottom: 10, fontSize: 12 }}>
              予約登録時に料金を自動計算します。部屋が空欄＝全部屋共通、時間が空欄＝終日適用。
            </div>
            {fees.map((f, i) => (
              <div class="fee-rule-card" key={i}>
                <div class="grid3">
                  <input type="text" placeholder="スタジオ" value={f.studio} onInput={(e) => setFee(i, { studio: e.currentTarget.value })} />
                  <input type="text" placeholder="部屋" value={f.room} onInput={(e) => setFee(i, { room: e.currentTarget.value })} />
                  <select value={f.days ?? ''} onChange={(e) => setFee(i, { days: e.currentTarget.value as FeeDays })}>
                    <option value="">毎日</option>
                    <option value="平日">平日</option>
                    <option value="土日祝">土日祝</option>
                  </select>
                </div>
                <div class="grid3" style={{ marginTop: 6 }}>
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
                <button class="btn small danger" style={{ marginTop: 8 }} onClick={() => setFees(fees.filter((_, j) => j !== i))}>
                  このルールを削除
                </button>
              </div>
            ))}
            <button class="btn small" onClick={() => setFees([...fees, { studio: '', room: '', days: '', from: '', to: '', fee: 0 }])}>
              ＋ 料金ルールを追加
            </button>
          </section>

          <div class="section-title">キャンセル期限前のお知らせ</div>
          <section class="card">
            <div class="muted" style={{ marginBottom: 8, fontSize: 12 }}>
              各スタジオの無料キャンセル期限（何日前・時刻）を設定します。最低人数未満のとき、この日時に予約者へお知らせが届きます。
            </div>
            {rules.map((r, i) => (
              <div class="grid3" style={{ marginBottom: 8 }} key={i}>
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
            <button class="btn small" onClick={() => setRules([...rules, { studio: '', daysBefore: 1, time: '10:00' }])}>
              ＋ キャンセルルールを追加
            </button>
          </section>

          <div class="section-title">共通ルール</div>
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

          <button class="btn primary block" style={{ marginTop: 20 }} disabled={busy} onClick={saveSettings}>
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
      <div class="section-title">スタジオと部屋</div>
      <section class="card">
        <div class="muted" style={{ marginBottom: 8, fontSize: 12 }}>
          スタジオ名と部屋（定員目安・広さ）を登録しておくと、予約登録時に補完されます。
        </div>
        {studios.map((s, i) => (
          <details key={i} class="studio-details" style={{ marginBottom: 12 }}>
            <summary class="row" style={{ alignItems: 'center' }}>
              <strong class="grow">{s.name || '（新しいスタジオ）'}</strong>
              <button
                type="button"
                class="btn small danger"
                style={{ marginLeft: 8 }}
                onClick={(e) => {
                  e.preventDefault();
                  if (confirm(`${s.name}を削除しますか？`)) onChange(studios.filter((_, j) => j !== i));
                }}
              >
                削除
              </button>
            </summary>
            <div style={{ marginTop: 8 }}>
              <input
                type="text"
                placeholder="スタジオ名"
                value={s.name}
                onInput={(e) => setStudio(i, { name: e.currentTarget.value })}
              />
              <input
                type="text"
                placeholder="表記ゆれ（カンマ区切り）"
                style={{ marginTop: 6 }}
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
              <div class="section-title" style={{ marginTop: 12, fontSize: 11 }}>
                部屋一覧
              </div>
              {s.rooms.map((r, ri) => (
                <div class="row" style={{ marginTop: 6, gap: 6 }} key={ri}>
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
                    class="btn small"
                    onClick={() =>
                      setStudio(i, {
                        rooms: s.rooms.filter((_, j) => j !== ri),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                class="btn small"
                style={{ marginTop: 8 }}
                onClick={() =>
                  setStudio(i, {
                    rooms: [...s.rooms, { name: '', size: '' }],
                  })
                }
              >
                ＋ 部屋を追加
              </button>
            </div>
          </details>
        ))}
        <div class="row" style={{ marginTop: 14 }}>
          <button class="btn small" onClick={() => onChange([...studios, { name: '', aliases: [], rooms: [] }])}>
            ＋ スタジオを追加
          </button>
          <button
            class="btn small"
            onClick={() =>
              confirm('スタジオと部屋の一覧を初期値に戻しますか？') &&
              onChange(DEFAULT_STUDIOS.map((s) => ({ ...s, rooms: s.rooms.map((r) => ({ ...r })) })))
            }
          >
            初期値に戻す
          </button>
        </div>
      </section>
    </>
  );
}
