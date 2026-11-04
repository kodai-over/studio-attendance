import { useEffect, useRef, useState } from 'preact/hooks';
import { labelDate, toJstDate, toJstTime, yen } from '@studio-attendance/shared';
import { api } from '../api';
import { FRESH_MS, Icon, Spinner, Syncing, Tabs, TopBar, go, place, useApp, useRunner } from '../ui';
import { getDraftOwnerKey, getUnansweredSummary } from './answerLogic';
import {
  LATEST_RELEASE_VERSION,
  RELEASE_NOTES,
  buildHomeNotices,
  formatNoticeTime,
  getHomeUnreadStatus,
  getNextGoingPractice,
  getNoticeReadAt,
  markNoticesRead,
  markReleaseNotesRead,
  syncPracticeNotices,
} from './homeLogic';
import { PracticeCard } from './List';

type HomeSubTab = 'notices' | 'releases';

export function HomePage() {
  const { me, practices: list, practicesAt, setPractices } = useApp();
  const [subTab, setSubTab] = useState<HomeSubTab>('notices');
  const [, setReadTick] = useState(0);
  const [run, busy] = useRunner();

  // ホーム画面を開いた時点（またはアカウント切り替え時点）の既読時刻を保持し、
  // この画面を見ている間に markNoticesRead で localStorage が更新されても未読ドットが即消えないようにする
  const ownerKey = getDraftOwnerKey(me);
  const initialReadAtRef = useRef<{ ownerKey: string; readAt: string | null } | null>(null);
  if (!initialReadAtRef.current || initialReadAtRef.current.ownerKey !== ownerKey) {
    initialReadAtRef.current = { ownerKey, readAt: getNoticeReadAt(me) };
  }
  const readAtBefore = initialReadAtRef.current.readAt;

  useEffect(() => {
    if (practicesAt > 0 && Date.now() - practicesAt > FRESH_MS) {
      run(() => api('listPractices')).then((r) => {
        if (!r) return;
        syncPracticeNotices(r, me);
        setPractices(r, true);
      });
    }
  }, []);

  const now = new Date();
  const today = toJstDate(now);
  const currentTime = toJstTime(now);

  const { totalCount: todoCount } = getUnansweredSummary(list, me, today, currentTime);
  const nextGoing = getNextGoingPractice(list, today, currentTime);
  const notices = buildHomeNotices(list, me, today, currentTime);
  const unreadStatus = getHomeUnreadStatus(list, me, today, currentTime);

  // 「お知らせ」タブ表示中かつ最新一覧の取得完了時（practicesAt > 0）に既読更新する
  useEffect(() => {
    if (!list || practicesAt === 0 || subTab !== 'notices') return;
    const latestAt = notices[0]?.updatedAt;
    markNoticesRead(me, latestAt);
  }, [list, practicesAt, subTab, ownerKey, notices[0]?.updatedAt]);

  const handleSelectSubTab = (t: HomeSubTab) => {
    setSubTab(t);
    if (t === 'notices') {
      markNoticesRead(me, notices[0]?.updatedAt);
    } else if (t === 'releases') {
      markReleaseNotesRead(me);
    }
    setReadTick((x) => x + 1);
  };

  if (list == null) {
    return (
      <>
        <TopBar title="ホーム" showTheme />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <TopBar title="ホーム" showTheme>
        {(practicesAt === 0 || busy) && <Syncing />}
      </TopBar>

      {todoCount > 0 && (
        <button class="banner" onClick={() => go('/answer')}>
          <span class="count-badge">{todoCount}</span>
          <span class="grow">
            <strong>未回答の予約情報が{todoCount}件あります</strong>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}

      <section>
        <div class="sec-head big">
          <span class="grow">次の参加予定</span>
          <button class="btn plain small link" onClick={() => go('/?tab=mine')}>
            すべて見る
          </button>
        </div>
        {nextGoing ? (
          <button class="next-card" onClick={() => go(`/p/${encodeURIComponent(nextGoing.practice.id)}`)}>
            <div class="when">
              {labelDate(nextGoing.practice.date)} {nextGoing.practice.start}–{nextGoing.practice.end}
            </div>
            <div class="place">{place(nextGoing.practice)}</div>
            <div class="ticket-meta">
              <span class="meta-item">
                <Icon name="people" size={16} />
                {nextGoing.going.length}人
              </span>
              <span class="fee">1人あたり {nextGoing.perPerson != null ? yen(nextGoing.perPerson) : '—'}</span>
            </div>
          </button>
        ) : (
          <div class="empty small">次の参加予定はありません</div>
        )}
      </section>

      <section class="section">
        <div class="tabs-head">
          <Tabs
            value={subTab}
            onChange={handleSelectSubTab}
            items={[
              {
                key: 'notices',
                label: 'お知らせ',
                count: unreadStatus.unreadNoticesCount > 0 ? unreadStatus.unreadNoticesCount : undefined,
              },
              {
                key: 'releases',
                label: 'リリースノート',
                count: unreadStatus.hasUnreadReleaseNote ? 1 : undefined,
              },
            ]}
          />
        </div>

        {subTab === 'notices' ? (
          notices.length === 0 ? (
            <div class="empty small">お知らせはありません</div>
          ) : (
            <ul class="notice-list">
              {notices.map((n) => {
                const isUnread = readAtBefore != null && n.updatedAt > readAtBefore;
                return (
                  <li key={n.id}>
                    <button class={`notice${isUnread ? ' is-unread' : ''}`} onClick={() => go(`/p/${encodeURIComponent(n.practiceId)}`)}>
                      <span class={`notice-icon ${n.kind}`}>
                        <Icon name={n.kind === 'practice_canceled' ? 'x' : n.kind === 'practice_changed' ? 'edit' : 'user'} size={16} />
                      </span>
                      <span class="notice-body">
                        <span class="notice-title">
                          {isUnread && <span class="sr">未読 </span>}
                          {n.title}
                        </span>
                        <span class="notice-sub">
                          <span class="notice-detail">{n.detail}</span>
                          <time>{formatNoticeTime(n.updatedAt)}</time>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : RELEASE_NOTES.length === 0 ? (
          <div class="empty small">リリースノートはありません</div>
        ) : (
          <ul class="notice-list">
            {RELEASE_NOTES.map((rel) => (
              <li key={rel.version}>
                <article class="release">
                  <div class="release-head">
                    <span class="ver">{rel.version}</span>
                    {rel.version === LATEST_RELEASE_VERSION && <span class="label">最新</span>}
                    <time>{rel.date}</time>
                  </div>
                  {rel.summary && <p class="release-summary">{rel.summary}</p>}
                  {rel.sections.map((sec) => (
                    <div key={sec.heading} class="release-sec">
                      <h4>{sec.heading}</h4>
                      <ul>
                        {sec.items.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
