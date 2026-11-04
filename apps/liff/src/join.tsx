/** 参加リンクのページ。LINEを使わない人が名前を入れて回答する */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { yen, type Answer, type JoinView } from '@studio-attendance/shared';
import { joinApi } from './api';
import './styles.css';
import { initTheme } from './theme';
import { ANSWER_LABEL, Pass, RsvpButtons, Spinner, useToast } from './ui';

initTheme();

const q = new URLSearchParams(location.search);
const id = q.get('p') ?? '';
const key = q.get('k') ?? '';
const NAME_KEY = 'pb:name';
const pidKey = `pb:join:${id}`;

const load = (k: string) => {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const save = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 保存できなくても回答はできる */
  }
};

function JoinPage() {
  const [v, setV] = useState<JoinView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(() => load(NAME_KEY));
  const [busy, setBusy] = useState(false);
  const [toast, toastNode] = useToast();

  useEffect(() => {
    joinApi('get', { id, key, participant: load(pidKey) || undefined })
      .then(setV)
      .catch((e) => setError(e.message));
  }, []);

  const answer = async (a: Answer) => {
    if (!name.trim()) return toast('名前を入力してください', true);
    setBusy(true);
    try {
      const r = await joinApi('answer', { id, key, name: name.trim(), answer: a, participant: load(pidKey) || undefined });
      save(NAME_KEY, name.trim());
      save(pidKey, r.participant);
      setV(r);
      toast(`「${ANSWER_LABEL[a]}」で回答しました`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div class="empty">{error}</div>;
  if (!v) return <Spinner />;
  const closed = v.status === '中止';

  return (
    <>
      <h1 class="large-title join-title">RSVP</h1>
      <Pass
        date={v.date}
        status={v.status}
        fields={[
          { label: '時間', value: `${v.start}–${v.end}`, wide: true },
          { label: 'スタジオ', value: v.studio, wide: !v.room },
          ...(v.room ? [{ label: '部屋', value: v.room, note: v.roomInfo }] : []),
          { label: '参加人数', value: v.goingCount },
          { label: '1人あたり', value: v.perPerson != null ? yen(v.perPerson) : '—' },
          ...(v.memo ? [{ label: 'メモ', value: v.memo, wide: true }] : []),
        ]}
      />

      {!closed && (
        <>
          <label class="field">
            <span>名前</span>
            <input type="text" value={name} maxLength={30} placeholder="名前" onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <div class="section-gap">
            <RsvpButtons solo value={v.myAnswer} status={v.status} busy={busy} onAnswer={answer} />
          </div>
          <p class="note center section-gap">LINEなしで回答できます。押し直すと変更できます</p>
        </>
      )}
      {toastNode}
    </>
  );
}

render(
  <div class="app">
    <JoinPage />
  </div>,
  document.getElementById('app')!,
);
