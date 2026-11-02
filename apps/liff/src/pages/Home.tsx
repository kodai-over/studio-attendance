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
      <TopBar title="ホーム" showTheme />
      {(practicesAt === 0 || busy) && <Syncing />}

      {/* 1. 未回答の予約情報バナー（GitHub Announcement Banner 風） */}
      {todoCount > 0 && (
        <button class="gh-flash-banner" onClick={() => go('/answer')}>
          <div class="gh-flash-main">
            <span class="gh-flash-badge">{todoCount}</span>
            <div class="gh-flash-text">
              <strong>未回答の予約情報が {todoCount} 件あります</strong>
              <span>RSVP からまとめて回答できます</span>
            </div>
          </div>
          <span class="gh-flash-action">
            <span>回答する</span>
            <Icon name="chevron" size={13} />
          </span>
        </button>
      )}

      {/* 2. 次の参加予定（GitHub Pinned Repository 風） */}
      <section class="home-section">
        <div class="home-section-head">
          <h2 class="gh-section-title">次の参加予定</h2>
          <button class="gh-section-link" onClick={() => go('/?tab=mine')}>
            <span>予定へ</span>
            <Icon name="chevron" size={13} />
          </button>
        </div>
        {nextGoing ? (
          <article
            class="gh-pinned-card"
            onClick={() => go(`/p/${encodeURIComponent(nextGoing.practice.id)}`)}
          >
            <div class="gh-pinned-header">
              <div class="gh-pinned-title-wrap">
                <Icon name="calendar" size={15} />
                <span class="gh-pinned-title">
                  {labelDate(nextGoing.practice.date)} {nextGoing.practice.start}–{nextGoing.practice.end}
                </span>
              </div>
              <span class="gh-pill-badge">参加確定</span>
            </div>
            <p class="gh-pinned-body">{place(nextGoing.practice)}</p>
            <div class="gh-pinned-footer">
              <span class="gh-meta-stat">
                <span class="gh-stat-dot" />
                <span>{nextGoing.going.length}人参加</span>
              </span>
              <span class="gh-meta-stat">
                1人あたり {yen(nextGoing.practice.fee ? Math.ceil(nextGoing.practice.fee / Math.max(1, nextGoing.going.length)) : 0)}
              </span>
              {nextGoing.bookerName && (
                <span class="gh-meta-stat">
                  <Icon name="user" size={12} />
                  <span>{nextGoing.bookerName}</span>
                </span>
              )}
            </div>
          </article>
        ) : (
          <div class="gh-blankslate">
            <span>次の参加予定はありません。</span>
          </div>
        )}
      </section>

      {/* 3. お知らせ / リリースノート（GitHub Contribution Activity タイムライン風） */}
      <section class="home-section" style={{ marginTop: 24 }}>
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
            <div class="gh-blankslate" style={{ marginTop: 12 }}>
              <span>お知らせはありません。</span>
            </div>
          ) : (
            <div class="gh-timeline">
              {notices.map((n) => {
                const isUnread = readAtBefore != null && n.updatedAt > readAtBefore;
                return (
                  <div key={n.id} class={`gh-timeline-item${isUnread ? ' is-unread' : ''}`}>
                    <div class={`gh-timeline-badge ${n.kind}`}>
                      <Icon
                        name={
                          n.kind === 'practice_canceled'
                            ? 'x'
                            : n.kind === 'practice_changed'
                            ? 'edit'
                            : 'user'
                        }
                        size={12}
                      />
                    </div>
                    <button
                      class="gh-timeline-body"
                      onClick={() => go(`/p/${encodeURIComponent(n.practiceId)}`)}
                    >
                      <div class="gh-timeline-header">
                        <span class="gh-timeline-title">
                          {n.title}
                          {isUnread && <span class="gh-unread-tag">未読</span>}
                        </span>
                        <span class="gh-timeline-time">{formatNoticeTime(n.updatedAt)}</span>
                      </div>
                      <div class="gh-timeline-box">
                        <span class="gh-timeline-detail">{n.detail}</span>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )
        ) : RELEASE_NOTES.length === 0 ? (
          <div class="gh-blankslate" style={{ marginTop: 12 }}>
            <span>リリースノートはありません。</span>
          </div>
        ) : (
          <div class="gh-timeline">
            {RELEASE_NOTES.map((rel) => {
              const isLatest = rel.version === LATEST_RELEASE_VERSION;
              return (
                <div key={rel.version} class={`gh-timeline-item release${isLatest ? ' is-latest' : ''}`}>
                  <div class="gh-timeline-badge release">
                    <Icon name="note" size={12} />
                  </div>
                  <article class="gh-timeline-body release-body">
                    <div class="gh-timeline-header">
                      <div class="gh-release-title-row">
                        <span class="gh-release-version">{rel.version}</span>
                        {isLatest && <span class="gh-pill-badge latest">Latest</span>}
                      </div>
                      <span class="gh-timeline-time">{rel.date}</span>
                    </div>
                    {rel.summary && <p class="gh-release-summary">{rel.summary}</p>}
                    <div class="gh-release-content">
                      {rel.sections.map((sec) => (
                        <div key={sec.heading} class="gh-release-sec">
                          <h4>{sec.heading}</h4>
                          <ul>
                            {sec.items.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
