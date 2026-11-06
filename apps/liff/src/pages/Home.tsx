import { useEffect, useRef, useState } from 'preact/hooks';
import { toJstDate, toJstTime } from '@studio-attendance/shared';
import { api } from '../api';
import { FRESH_MS, Icon, Spinner, Syncing, Tabs, TopBar, go, useApp, useRunner } from '../ui';
import { getDraftOwnerKey } from './answerLogic';
import {
  LATEST_RELEASE_VERSION,
  RELEASE_NOTES,
  buildHomeNotices,
  buildTodoNotices,
  formatNoticeTime,
  getHomeUnreadStatus,
  getNextGoingPractice,
  getNoticeReadAt,
  getTodayPractices,
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

  const todayPractices = getTodayPractices(list, me, today);
  const nextGoing = getNextGoingPractice(list, today);
  const todoNotices = buildTodoNotices(list, me, today, currentTime);
  const historyNotices = buildHomeNotices(list, me, today, currentTime);
  const notices = [...todoNotices, ...historyNotices];
  const unreadStatus = getHomeUnreadStatus(list, me, today, currentTime);

  // 「お知らせ」タブ表示中かつ最新一覧の取得完了時（practicesAt > 0）に既読更新する
  useEffect(() => {
    if (!list || practicesAt === 0 || subTab !== 'notices') return;
    const latestAt = historyNotices[0]?.updatedAt;
    markNoticesRead(me, latestAt);
  }, [list, practicesAt, subTab, ownerKey, historyNotices[0]?.updatedAt]);

  const handleSelectSubTab = (t: HomeSubTab) => {
    setSubTab(t);
    if (t === 'notices') {
      markNoticesRead(me, historyNotices[0]?.updatedAt);
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

      <section>
        <div class="sec-head big">
          <span>今日の予定</span>
        </div>
        {todayPractices.length > 0 ? (
          <div class="ticket-grid">
            {todayPractices.map((v) => (
              <PracticeCard key={v.practice.id} v={v} />
            ))}
          </div>
        ) : (
          <div class="empty small">今日の予定はありません</div>
        )}
      </section>

      <section class="section">
        <div class="sec-head big">
          <span>次の参加予定</span>
        </div>
        {nextGoing ? (
          <PracticeCard v={nextGoing} />
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
                const isTodo = n.kind === 'todo';
                const isUnread = !isTodo && readAtBefore != null && n.updatedAt > readAtBefore;
                const handleClick = () => {
                  if (isTodo) {
                    go(`/answer?r=${encodeURIComponent(n.practiceId)}`);
                  } else {
                    go(`/p/${encodeURIComponent(n.practiceId)}`);
                  }
                };
                return (
                  <li key={n.id}>
                    <button
                      class={`notice${isUnread ? ' is-unread' : ''}${isTodo ? ' is-todo' : ''}`}
                      onClick={handleClick}
                    >
                      <span class={`notice-icon ${n.kind}`}>
                        <Icon
                          name={
                            n.kind === 'todo'
                              ? 'check'
                              : n.kind === 'practice_canceled'
                              ? 'x'
                              : n.kind === 'practice_changed'
                              ? 'edit'
                              : 'user'
                          }
                          size={16}
                        />
                      </span>
                      <span class="notice-body">
                        <span class="notice-title">
                          {isUnread && <span class="sr">未読 </span>}
                          {n.title}
                        </span>
                        <span class="notice-sub">
                          <span class="notice-detail">{n.detail}</span>
                          {!isTodo && <time>{formatNoticeTime(n.updatedAt)}</time>}
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
