import { useState } from 'preact/hooks';
import { api } from '../api';
import { Icon, TopBar, useApp, useRunner } from '../ui';

/** 要望を送るだけの画面（届いた要望はスプレッドシートの「要望」シートで見る） */
export function FeedbackPage() {
  const { me } = useApp();
  const [text, setText] = useState('');
  const [run, busy] = useRunner();

  const post = async (e: Event) => {
    e.preventDefault();
    if (await run(() => api('postFeedback', { text }), '要望を送りました')) setText('');
  };

  return (
    <>
      <TopBar title="要望" back />
      <form onSubmit={post}>
        <p class="note section-gap-bottom">{me.member.name} として、管理者だけに届きます</p>
        <textarea rows={6} maxLength={1000} value={text} aria-label="要望" placeholder="こうなったら便利、ここが使いにくい、など" onInput={(e) => setText(e.currentTarget.value)} />
        <button class="btn primary block section-gap" disabled={busy || !text.trim()}>
          <Icon name="send" size={18} />
          送る
        </button>
      </form>
    </>
  );
}
