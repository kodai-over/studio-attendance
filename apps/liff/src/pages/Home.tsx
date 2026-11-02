import { useEffect, useRef, useState } from 'preact/hooks';
import { toJstDate, toJstTime } from '@studio-attendance/shared';
import { api } from '../api';
import { FRESH_MS, Icon, Spinner, Syncing, Tabs, TopBar, go, useApp, useRunner } from '../ui';
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
      <TopBar title="ホーム" showTheme />
      {(practicesAt === 0 || busy) && <Syncing />}

      {/* 1. 未回答の予約情報バナー */}
      {todoCount > 0 && (
        <button class="home-todo-banner" onClick={() => go('/answer')}>
          <div class="home-todo-banner-main">
            <span class="home-todo-badge">{todoCount}</span>
            <div class="home-todo-text">
              <strong>未回答の予約情報が {todoCount} 件あります</strong>
              <span>RSVP から回答できます</span>
            </div>
          </div>
          <Icon name="chevron" size={18} />
        </button>
      )}

      {/* 2. 次の参加予定 */}
      <section class="home-section">
        <div class="home-section-head">
          <h2 class="section-title" style={{ margin: 0 }}>次の参加予定</h2>
          <button class="home-section-link" onClick={() => go('/?tab=mine')}>
            <span>予定へ</span>
            <Icon name="chevron" size={14} />
          </button>
        </div>
        {nextGoing ? (
          <div class="ticket-grid" style={{ marginTop: 8 }}>
            <PracticeCard v={nextGoing} />
          </div>
        ) : (
          <div class="home-empty-card">
            <span>次の参加予定はありません。</span>
          </div>
        )}
      </section>

      {/* 3. お知らせ / リリースノート */}
      <section class="home-section" style={{ marginTop: 22 }}>
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
              label: unreadStatus.hasUnreadReleaseNote ? `リリースノート ●` : 'リリースノート',
            },
          ]}
        />

        {subTab === 'notices' ? (
          notices.length === 0 ? (
            <div class="home-empty-card" style={{ marginTop: 12 }}>
              <span>お知らせはありません。</span>
            </div>
          ) : (
            <ul class="home-notice-list">
              {notices.map((n) => {
                const isUnread = readAtBefore != null && n.updatedAt > readAtBefore;
                return (
                  <li key={n.id}>
                    <button
                      class={`home-notice-item${isUnread ? ' is-unread' : ''}`}
                      onClick={() => go(`/p/${encodeURIComponent(n.practiceId)}`)}
                    >
                      <div class={`home-notice-icon ${n.kind}`}>
                        <Icon
                          name={
                            n.kind === 'practice_canceled'
                              ? 'x'
                              : n.kind === 'practice_changed'
                              ? 'edit'
                              : 'check'
                          }
                          size={15}
                        />
                      </div>
                      <div class="home-notice-body">
                        <div class="home-notice-title-row">
                          <span class="home-notice-title">{n.title}</span>
                          {isUnread && <span class="home-unread-dot" aria-label="未読" />}
                        </div>
                        <div class="home-notice-meta">
                          <span class="home-notice-detail">{n.detail}</span>
                          <span class="home-notice-time">{formatNoticeTime(n.updatedAt)}</span>
                        </div>
                      </div>
                      <Icon name="chevron" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : RELEASE_NOTES.length === 0 ? (
          <div class="home-empty-card" style={{ marginTop: 12 }}>
            <span>リリースノートはありません。</span>
          </div>
        ) : (
          <div class="home-release-list">
            {RELEASE_NOTES.map((rel) => {
              const isLatest = rel.version === LATEST_RELEASE_VERSION;
              return (
                <article key={rel.version} class={`home-release-card${isLatest ? ' is-latest' : ''}`}>
                  <div class="home-release-head">
                    <div class="home-release-ver-wrap">
                      <span class="home-release-ver">{rel.version}</span>
                      {isLatest && <span class="home-release-badge">最新</span>}
                    </div>
                    <span class="home-release-date">{rel.date}</span>
                  </div>
                  {rel.summary && <p class="home-release-summary">{rel.summary}</p>}
                  {rel.sections.map((sec) => (
                    <div key={sec.heading} class="home-release-sec">
                      <h4>{sec.heading}</h4>
                      <ul>
                        {sec.items.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
