import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STUDIOS,
  addDays,
  canonicalizeStudio,
  roomInfo,
  buildIcs,
  canNotifyPracticeCancellation,
  cancelWarningAt,
  computeCancelDeadline,
  classifyReservations,
  confirmCard,
  defaultFee,
  DEFAULT_FEES,
  formatFeeValue,
  isHoliday,
  isHolidayOrWeekend,
  isMinePractice,
  isRsvpTarget,
  isStartedPractice,
  jpHolidays,
  parseFeeValue,
  findCancelRule,
  googleCalendarUrl,
  jstDateTime,
  labelDate,
  looksLikeReservation,
  makePracticeId,
  nextStatus,
  normalizeReservation,
  parsePostback,
  perPersonFee,
  endAfterStart,
  practiceCancellationMessage,
  practiceListMessage,
  recruitMessages,
  answerChangeReport,
  answerReport,
  warningCard,
  shouldNotifyPracticeCancellation,
  toJstDate,
  yen,
  type Practice,
  type Settings,
} from '../src';

const practice = (over: Partial<Practice> = {}): Practice => ({
  id: 'worcle-20261021-1900-A',
  date: '2026-10-21',
  start: '19:00',
  end: '21:00',
  studio: 'worcle',
  room: 'A',
  fee: 6000,
  booker: 'U1',
  max: null,
  min: null,
  memo: '',
  status: '募集中',
  groups: ['G1'],
  joinKey: 'k',
  feeOverride: null,
  warned: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const settings: Settings = {
  studios: DEFAULT_STUDIOS,
  fees: [
    { studio: 'worcle', room: 'A', fee: 1650 },
    { studio: 'worcle', room: '', fee: 1250 },
    { studio: 'BUZZ', room: '', fee: 2000 },
  ],
  cancelRules: [
    { studio: 'worcle', daysBefore: 4, time: '10:00' },
    { studio: 'BUZZ', daysBefore: 1, time: '10:00' },
  ],
  minDefault: 3,
  roundUnit: 10,
  groups: [{ id: 'G1', name: 'チームA' }],
};

describe('日付', () => {
  it('日本時間で扱う', () => {
    expect(toJstDate(new Date('2026-10-20T15:30:00Z'))).toBe('2026-10-21');
    expect(jstDateTime('2026-10-21', '19:00').toISOString()).toBe('2026-10-21T10:00:00.000Z');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(labelDate('2026-10-21')).toBe('10/21(水)');
  });
});

describe('練習ID', () => {
  it('スタジオ＋日付＋開始時刻＋部屋', () => {
    expect(makePracticeId({ studio: 'BUZZ 横浜東口', date: '2026-10-21', start: '19:00', room: 'Studio 3' })).toBe(
      'BUZZ横浜東口-20261021-1900-Studio3',
    );
  });
});

describe('normalizeReservation', () => {
  it('時刻や料金を整える', () => {
    expect(normalizeReservation({ date: '2026-10-21', start: '9:00', end: '11:00', studio: 'worcle', room: 'A', fee: '¥3,300' })).toEqual({
      date: '2026-10-21',
      start: '09:00',
      end: '11:00',
      studio: 'worcle',
      room: 'A',
      fee: 3300,
    });
  });
  it('必須項目が欠けたら null', () => {
    expect(normalizeReservation({ date: '2026-10-21', start: '19:00', end: null, studio: 'worcle' })).toBeNull();
    expect(normalizeReservation({ date: '2026-02-30', start: '19:00', end: '21:00', studio: 'worcle' })).toBeNull();
    expect(normalizeReservation({ date: '2026-10-21', start: '21:00', end: '19:00', studio: 'worcle' })).toBeNull();
  });
  it('料金が読めなければ null', () => {
    expect(normalizeReservation({ date: '2026-10-21', start: '19:00', end: '21:00', studio: 'worcle', fee: null })?.fee).toBeNull();
  });
});

describe('設定', () => {
  it('スタジオ代は30分あたりの標準料金 × 利用時間。部屋の一致を優先', () => {
    const d = '2026-10-28';
    expect(defaultFee(settings, { studio: 'worcle', room: 'B', date: d, start: '19:00', end: '21:00' })).toBe(5000);
    expect(defaultFee(settings, { studio: 'worcle', room: 'A', date: d, start: '19:00', end: '20:30' })).toBe(4950);
    expect(defaultFee(settings, { studio: 'worcle', room: 'B', date: d, start: '23:00', end: '25:00' })).toBe(5000);
    expect(defaultFee(settings, { studio: 'BUZZ横浜東口', room: 'Ast', date: d, start: '19:00', end: '20:00' })).toBe(4000);
    expect(defaultFee(settings, { studio: 'other', room: '', date: d, start: '19:00', end: '21:00' })).toBe(0);
    expect(defaultFee(settings, { studio: 'worcle', room: 'B', date: d, start: '', end: '' })).toBe(0);
  });
  it('公式の料金表: 平日・土日祝と時間帯で料金が変わる', () => {
    const s = { ...settings, fees: DEFAULT_FEES };
    const fee = (studio: string, room: string, date: string, start: string, end: string) => defaultFee(s, { studio, room, date, start, end });
    // 平日（月）の 16:00〜19:00 は 10:00〜17:00 の料金と 17:00〜 の料金をまたぐ
    expect(fee('BUZZ横浜', '1スタジオ', '2026-10-26', '16:00', '19:00')).toBe(2 * 900 + 4 * 1300);
    // 祝日（文化の日・火）は土日祝の料金
    expect(fee('BUZZ横浜', '1スタジオ', '2026-11-03', '16:00', '19:00')).toBe(6 * 1300);
    expect(fee('BUZZ横浜東口', 'Bst', '2026-10-31', '19:00', '21:00')).toBe(4 * 900);
    expect(fee('studio worcle 横浜', '202', '2026-10-28', '19:00', '21:00')).toBe(4 * 1100);
    // 30分に満たない分は割合で
    expect(fee('studio worcle 横浜', '202', '2026-10-28', '19:00', '19:45')).toBe(1650);
    // 深夜パック・6時間セットの時間帯は料金表にないので計算しない
    expect(fee('BUZZ横浜', '1スタジオ', '2026-10-26', '23:00', '24:00')).toBe(0);
    expect(fee('studio worcle 横浜', '202', '2026-10-28', '23:00', '25:00')).toBe(0);
  });
  it('祝日（振替休日・国民の休日を含む）', () => {
    const h = jpHolidays(2026);
    for (const d of ['2026-01-12', '2026-03-20', '2026-05-06', '2026-07-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-23']) expect(h.has(d)).toBe(true);
    expect(h.has('2026-10-26')).toBe(false);
    expect(isHoliday('2026-11-03')).toBe(true); // 文化の日（火）
    expect(isHoliday('2026-11-04')).toBe(false);
    expect(isHolidayOrWeekend('2026-10-25')).toBe(true);
    expect(isHolidayOrWeekend('2026-10-26')).toBe(false);
  });
  it('設定シートの標準料金の書き方', () => {
    expect(parseFeeValue('平日 17:00-23:30 1,300')).toEqual({ days: '平日', from: '17:00', to: '23:30', fee: 1300 });
    expect(parseFeeValue('１１００')).toEqual({ days: '', from: '', to: '', fee: 1100 });
    expect(parseFeeValue('高い')).toBeNull();
    expect(formatFeeValue({ studio: 'x', room: '', days: '土日祝', from: '10:00', to: '23:30', fee: 1300 })).toBe('土日祝 10:00-23:30 1300');
  });
  it('キャンセル期限は前方一致', () => {
    expect(findCancelRule(settings.cancelRules, 'BUZZ横浜東口')?.daysBefore).toBe(1);
    expect(findCancelRule(settings.cancelRules, 'その他')).toBeNull();
  });
  it('キャンセル期限の計算', () => {
    // 2026-11-02(月) の worcle(4日前 10:00 JST = 2026-10-29T01:00:00Z)
    // 期限より25時間前 -> isPast: false, isSoon: false
    const far = computeCancelDeadline('2026-11-02', 'studio worcle 横浜', settings.cancelRules, new Date('2026-10-27T23:59:00.000Z'));
    expect(far).not.toBeNull();
    expect(far?.formatted).toBe('10/29(木) 10:00');
    expect(far?.isPast).toBe(false);
    expect(far?.isSoon).toBe(false);

    // 期限より20時間前（24時間以内） -> isPast: false, isSoon: true (強調対象)
    const soon = computeCancelDeadline('2026-11-02', 'studio worcle 横浜', settings.cancelRules, new Date('2026-10-28T05:00:00.000Z'));
    expect(soon?.isPast).toBe(false);
    expect(soon?.isSoon).toBe(true);

    // 期限後 -> isPast: true, isSoon: false (期限切れ)
    const past = computeCancelDeadline('2026-11-02', 'studio worcle 横浜', settings.cancelRules, new Date('2026-10-29T01:01:00.000Z'));
    expect(past?.isPast).toBe(true);
    expect(past?.isSoon).toBe(false);

    // ルール未設定のスタジオ
    expect(computeCancelDeadline('2026-11-02', '不明なスタジオ', settings.cancelRules)).toBeNull();
  });
  it('警告時刻', () => {
    expect(cancelWarningAt('2026-10-21', { studio: 'worcle', daysBefore: 4, time: '10:00' }).toISOString()).toBe(
      '2026-10-17T01:00:00.000Z',
    );
  });
});

describe('割り勘', () => {
  it('10円単位で切り上げ', () => {
    expect(perPersonFee(6000, 7, 10, null)).toBe(860);
    expect(perPersonFee(6000, 3, 10, null)).toBe(2000);
    expect(perPersonFee(6000, 7, 100, null)).toBe(900);
  });
  it('調整額を優先、0人は null', () => {
    expect(perPersonFee(6000, 7, 10, 800)).toBe(800);
    expect(perPersonFee(6000, 0, 10, null)).toBeNull();
  });
  it('金額表示', () => {
    expect(yen(1234567)).toBe('¥1,234,567');
  });
});

describe('状態', () => {
  it('上限で満員、減れば募集中に戻る', () => {
    expect(nextStatus(practice({ max: 3 }), 3)).toBe('満員');
    expect(nextStatus(practice({ max: 3, status: '満員' }), 2)).toBe('募集中');
    expect(nextStatus(practice({ status: '中止' }), 0)).toBe('中止');
  });
});

const all = () => true;

describe('classifyReservations', () => {
  it('新規・延長・登録済みを判定', () => {
    const existing = [practice()];
    const items = classifyReservations(existing, [
      { date: '2026-10-21', start: '19:00', end: '21:00', studio: 'worcle', room: 'A', fee: 6000 },
      { date: '2026-10-21', start: '21:00', end: '22:00', studio: 'worcle', room: 'A', fee: 3000 },
      { date: '2026-10-22', start: '19:00', end: '21:00', studio: 'worcle', room: 'A', fee: 6000 },
    ], all);
    expect(items.map((i) => i.kind)).toEqual(['duplicate', 'extension', 'new']);
    expect(items[1].targetId).toBe('worcle-20261021-1900-A');
  });
  it('中止した練習は登録済みとみなさない', () => {
    const items = classifyReservations([practice({ status: '中止' })], [
      { date: '2026-10-21', start: '19:00', end: '21:00', studio: 'worcle', room: 'A', fee: 6000 },
    ], all);
    expect(items[0].kind).toBe('new');
  });
});

describe('classifyReservations: 同じ登録内で続く予約', () => {
  const base = { studio: '横浜', room: '301' };
  it('予約一覧の形（19:00-20:30 と 20:30-21:00）は1件にまとめ、料金は合計', () => {
    const items = classifyReservations([], [
      { ...base, date: '2026-10-21', start: '19:30', end: '21:00', room: '202', fee: 3300 },
      { ...base, date: '2026-10-14', start: '20:30', end: '21:00', fee: 800 },
      { ...base, date: '2026-10-14', start: '19:00', end: '20:30', fee: 2400 },
    ], all);
    expect(items).toEqual([
      {
        kind: 'new',
        reservation: { ...base, date: '2026-10-14', start: '19:00', end: '21:00', fee: 3200 },
        // まとめる前の予約も残す（アプリで分け直せるように）
        parts: [
          { ...base, date: '2026-10-14', start: '19:00', end: '20:30', fee: 2400 },
          { ...base, date: '2026-10-14', start: '20:30', end: '21:00', fee: 800 },
        ],
      },
      { kind: 'new', reservation: { ...base, date: '2026-10-21', start: '19:30', end: '21:00', room: '202', fee: 3300 } },
    ]);
  });
  it('既存の練習に続く予約が2つあれば、1つの延長にまとめる', () => {
    const existing = practice({ studio: '横浜', room: '301', date: '2026-10-14', start: '19:00', end: '20:00', id: makePracticeId({ studio: '横浜', room: '301', date: '2026-10-14', start: '19:00' }) });
    const items = classifyReservations([existing], [
      { ...base, date: '2026-10-14', start: '20:00', end: '21:00', fee: 1000 },
      { ...base, date: '2026-10-14', start: '21:00', end: '22:00', fee: null },
    ], all);
    expect(items).toMatchObject([{ kind: 'extension', targetId: existing.id, reservation: { ...base, date: '2026-10-14', start: '20:00', end: '22:00', fee: null } }]);
    expect(items[0].parts).toHaveLength(2);
  });
});

describe('classifyReservations: 延長してよい練習を絞る', () => {
  const base = { studio: '横浜', room: '301', date: '2026-10-14' };
  const mine = practice({ ...base, start: '17:00', end: '19:00', id: makePracticeId({ ...base, start: '17:00' }), booker: 'Ume' });
  const others = practice({ ...base, start: '19:00', end: '20:00', id: makePracticeId({ ...base, start: '19:00' }), booker: 'Uother' });
  const canExtend = (p: { booker: string }) => p.booker === 'Ume';
  it('延長できない練習の後に続く2枠は、1件の新規にまとめる', () => {
    const items = classifyReservations([others], [
      { ...base, start: '20:00', end: '21:00', fee: 1000 },
      { ...base, start: '21:00', end: '22:00', fee: 1000 },
    ], canExtend);
    expect(items).toMatchObject([{ kind: 'new', reservation: { ...base, start: '20:00', end: '22:00', fee: 2000 } }]);
  });
  it('延長できる練習とできない練習が混ざっても、それぞれ判定する', () => {
    const items = classifyReservations([mine, { ...others, start: '20:00', end: '21:00', id: makePracticeId({ ...base, start: '20:00' }) }], [
      { ...base, start: '19:00', end: '20:00', fee: 1000 },
      { ...base, start: '21:00', end: '22:00', fee: 1000 },
    ], canExtend);
    expect(items.map((i) => [i.kind, i.targetId])).toEqual([['extension', mine.id], ['new', undefined]]);
  });
});

describe('スタジオ一覧', () => {
  const r = (studio: string, room: string) => ({ date: '2026-10-21', start: '19:00', end: '21:00', studio, room, fee: null });
  it('別名・表記ゆれ・部屋名から正式な名前にそろえる', () => {
    const c = (studio: string, room: string) => {
      const x = canonicalizeStudio(DEFAULT_STUDIOS, r(studio, room));
      return `${x.studio}|${x.room}`;
    };
    expect(c('わーくる横浜', '202')).toBe('studio worcle 横浜|202');
    expect(c('worcle横浜', '３０１')).toBe('studio worcle 横浜|301');
    expect(c('横浜', '301')).toBe('studio worcle 横浜|301');
    expect(c('横浜', '1')).toBe('BUZZ横浜|1スタジオ');
    expect(c('BUZZ横浜東口(天高6ｍスタジオ)', 'Bst')).toBe('BUZZ横浜東口|Bst');
    expect(c('BUZZ横浜東口', 'A')).toBe('BUZZ横浜東口|Ast');
    expect(c('BUZZ横浜', '3スタジオ')).toBe('BUZZ横浜|3スタジオ');
    expect(c('市民センター', '和室')).toBe('市民センター|和室');
    // 一覧にない部屋はそのまま（スタジオ側で部屋が増えたときなど）
    expect(c('BUZZ横浜', '7スタジオ')).toBe('BUZZ横浜|7スタジオ');
  });
  it('部屋の広さ', () => {
    expect(roomInfo(DEFAULT_STUDIOS, 'BUZZ横浜', '1スタジオ')).toBe('46.5㎡・天井2.3m');
    expect(roomInfo(DEFAULT_STUDIOS, 'studio worcle 横浜', '202')).toBe('約30㎡（〜10名目安）');
    expect(roomInfo(DEFAULT_STUDIOS, 'その他', 'A')).toBeNull();
  });
  it('料金・期限の設定はスタジオ名を含めば当たる', () => {
    expect(defaultFee({ ...settings, fees: [{ studio: 'worcle', room: '', fee: 1650 }] }, { studio: 'studio worcle 横浜', room: '202', date: '2026-10-28', start: '19:00', end: '20:00' })).toBe(3300);
    expect(findCancelRule([{ studio: 'BUZZ', daysBefore: 1, time: '10:00' }, { studio: 'BUZZ横浜東口', daysBefore: 2, time: '10:00' }], 'BUZZ横浜東口')?.daysBefore).toBe(2);
  });
});

describe('looksLikeReservation', () => {
  it('日付と時刻の両方があれば予約内容とみなす', () => {
    expect(looksLikeReservation('2026-10-21 19:30〜21:00 横浜 202 ¥3,300')).toBe(true);
    expect(looksLikeReservation('10月21日（水）１９：３０〜２１：００')).toBe(true);
    expect(looksLikeReservation('10/28 19:30-21:00')).toBe(true);
    expect(looksLikeReservation('こんにちは')).toBe(false);
    expect(looksLikeReservation('19:30に集合で')).toBe(false);
  });
});

describe('カレンダー', () => {
  it('Googleカレンダーのリンク', () => {
    const url = googleCalendarUrl(practice(), 'https://example.com');
    expect(url).toContain('dates=20261021T100000Z%2F20261021T120000Z');
  });
  it('ICS', () => {
    const ics = buildIcs(practice({ memo: '通し, 確認' }), 'https://example.com', new Date('2026-10-01T00:00:00Z'));
    expect(ics).toContain('DTSTART:20261021T100000Z');
    expect(ics).toContain('DESCRIPTION:通し\\, 確認\\nhttps://example.com');
    expect(ics.endsWith('\r\n')).toBe(true);
  });
});

describe('Flex Message', () => {
  const appUrl = 'https://liff.line.me/123-abc';

  it('募集カード: 練習を1枚に並べ、ボタンは「回答」だけ', () => {
    const items = [0, 1].map((i) => ({ practice: practice({ id: `p${i}`, date: addDays('2026-11-01', i), max: i ? 5 : null }), bookerName: 'おおゆち' }));
    const msgs = recruitMessages(items, appUrl, { id: 'C1', key: 'k1' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].altText).toBe('参加者募集: 11/1(日)・11/2(月)');
    const json = JSON.stringify(msgs[0]);
    expect(json).toContain('"text":"参加者募集"');
    expect(json).toContain('おおゆち');
    expect(json).toContain('"label":"回答"');
    expect(json).toContain(`"uri":"${appUrl}?r=p0&r=p1&g=C1&k=k1"`);
    // その場で答えるボタン（押すとトークに発言が流れる）は載せない
    expect(json).not.toContain('postback');
    expect(json).not.toContain('割り勘');
  });

  it('募集カード: 練習が多いときやリンクが長すぎるときは分ける', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ practice: practice({ id: `p${i}`, date: addDays('2026-10-21', i) }), bookerName: 'a' }));
    expect(recruitMessages(many, appUrl).map((m) => JSON.stringify(m).match(/r=p/g)!.length)).toEqual([12, 1]);
    const long = Array.from({ length: 5 }, (_, i) => ({ practice: practice({ id: `${'あ'.repeat(30)}${i}` }), bookerName: 'a' }));
    const msgs = recruitMessages(long, appUrl);
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) expect(JSON.stringify(m).match(/"uri":"([^"]+)"/)![1].length).toBeLessThanOrEqual(1000);
    expect(msgs.reduce((n, m) => n + JSON.stringify(m).match(/r=/g)!.length, 0)).toBe(5);
  });

  it('募集カード: メモは短くし、1件でもリンクに入りきらなければアプリのトップを開く', () => {
    const memo = 'あ'.repeat(100);
    const [card] = recruitMessages([{ practice: practice({ id: 'p0', memo }), bookerName: 'a' }], appUrl);
    expect(JSON.stringify(card)).toContain(`"${'あ'.repeat(40)}…"`);
    const huge = practice({ id: 'い'.repeat(400) });
    const [top] = recruitMessages([{ practice: huge, bookerName: 'a' }], appUrl, { id: 'C1', key: 'k1' });
    expect(JSON.stringify(top)).toContain(`"uri":"${appUrl}?g=C1&k=k1"`);
  });

  it('グループに伝える文: 行く・保留・行かないを日付でまとめ、未回答は載せない', () => {
    const at = (date: string, start: string) => ({ date, start });
    expect(
      answerReport([
        { practice: at('2026-11-02', '19:00'), answer: '行く' },
        { practice: at('2026-11-01', '19:00'), answer: '行く' },
        { practice: at('2026-11-03', '19:00'), answer: '行かない' },
        { practice: at('2026-11-04', '19:00'), answer: '保留' },
        { practice: at('2026-11-05', '19:00'), answer: null },
      ]),
    ).toBe('回答しました\n○ 11/1(日)・11/2(月) 行きます\n△ 11/4(水) 未定です\n✕ 11/3(火) 行きません');
    // 同じ日に2つあるときは開始時刻で見分ける
    const sameDay = answerReport([
      { practice: at('2026-11-01', '13:00'), answer: '行く' },
      { practice: at('2026-11-01', '19:00'), answer: '行かない' },
    ]);
    expect(sameDay).toBe('回答しました\n○ 11/1(日) 13:00 行きます\n✕ 11/1(日) 19:00 行きません');
    expect(answerReport([{ practice: at('2026-11-01', '13:00'), answer: null }])).toBeNull();
  });

  it('回答画面の回答済みタブで送る文（answerChangeReport）は変更前と変更後の回答を明示する', () => {
    const at = (date: string, start: string) => ({ date, start });
    expect(
      answerChangeReport([
        { practice: at('2026-11-02', '19:00'), from: '行く', to: '行かない' },
        { practice: at('2026-11-01', '19:00'), from: '保留', to: '行く' },
      ]),
    ).toBe('回答を変更しました\n・11/1(日): 未定 → 行く\n・11/2(月): 行く → 行かない');

    // 同じ日に2つあるときは開始時刻で見分ける
    const sameDay = answerChangeReport([
      { practice: at('2026-11-01', '13:00'), from: '行く', to: '保留' },
      { practice: at('2026-11-01', '19:00'), from: null, to: '行く' },
    ]);
    expect(sameDay).toBe('回答を変更しました\n・11/1(日) 13:00: 行く → 未定\n・11/1(日) 19:00: 未回答 → 行く');

    // 引数の配列を変更しない（非破壊的であること）
    const originalItems = [
      { practice: at('2026-11-03', '19:00'), from: '行く' as const, to: '行かない' as const },
      { practice: at('2026-11-01', '19:00'), from: '保留' as const, to: '行く' as const },
      { practice: at('2026-11-02', '19:00'), from: '保留' as const, to: '行かない' as const },
    ];
    const clone = [...originalItems];
    answerChangeReport(originalItems);
    expect(originalItems).toEqual(clone);

    expect(answerChangeReport([])).toBeNull();
  });

  it('キャンセル期限前のお知らせは「募集」の練習の画面を開き、グループごとにもう一度募集できる', () => {
    const groups = [{ id: 'C1', name: 'チームA' }, { id: 'C2', name: 'あ'.repeat(30) }];
    const json = JSON.stringify(warningCard({ practice: practice({ id: 'p1' }), going: 1, min: 3, groups, appUrl }));
    expect(json).toContain(`${appUrl}?manage=p1`);
    expect(json).not.toContain('?p=');
    expect(json).toContain('もう一度募集するか、キャンセルするか');
    expect(json).toContain('"data":"a=remind&p=p1&g=C1"');
    // ボタンの文字は40文字まで
    for (const m of json.matchAll(/"label":"([^"]*)"/g)) expect([...m[1]].length).toBeLessThanOrEqual(40);
  });

  it('キャンセル期限前のお知らせ: ボタンに入りきらない・送れるグループがないときは、もう一度募集を出さない', () => {
    const long = practice({ id: 'スタジオペンタ渋谷センター街店ダンス練習スタジオ-20261021-1900-Aスタジオ大' });
    const json = JSON.stringify(warningCard({ practice: long, going: 1, min: 3, groups: [{ id: 'C'.padEnd(33, '0'), name: 'チームA' }], appUrl }));
    expect(json).not.toContain('a=remind');
    expect(json).toContain('予約情報を開く');
    expect(json).not.toContain('もう一度募集するか');
  });

  it('確認カード: 「登録して募集」「登録のみ」「やめる」', () => {
    const base = {
      id: 'd1',
      booker: 'U1',
      items: [{ reservation: { date: '2026-10-22', start: '19:00', end: '21:00', studio: 'worcle', room: 'A', fee: 3300 }, kind: 'new' as const }],
      incomplete: [],
      pastCount: 0,
      createdAt: '',
    };
    // 「登録して募集」はアプリを開き、内容を確かめて予約ごとに募集先を選ぶ
    const one = JSON.stringify(confirmCard({ draft: { ...base, groups: ['G1'] }, groups: settings.groups, practices: [], appUrl }));
    expect(one).toContain(`"label":"登録して募集","uri":"${appUrl}?draft=d1&recruit=1"`);
    expect(one).toContain('"label":"登録のみ","data":"a=confirm&d=d1"');
    expect(one).toContain('"label":"やめる"');
    expect(one).not.toContain('修正して登録');
    // グループが2つ以上でも同じ
    const two = JSON.stringify(confirmCard({ draft: { ...base, groups: [] }, groups: [...settings.groups, { id: 'G2', name: 'チームB' }], practices: [], appUrl }));
    expect(two).toContain(`"label":"登録して募集","uri":"${appUrl}?draft=d1&recruit=1"`);
    expect(two).toContain('"label":"登録のみ"');
    // グループが無ければ登録だけ
    const none = JSON.stringify(confirmCard({ draft: { ...base, groups: [] }, groups: [], practices: [], appUrl }));
    expect(none).not.toContain('登録して募集');
    expect(none).not.toContain('アプリの練習画面からも');
    expect(none).toContain('"label":"登録のみ"');
    // 読み取れない項目があれば、登録ボタンは出さず修正してもらう
    const incomplete = JSON.stringify(confirmCard({ draft: { ...base, groups: ['G1'], incomplete: [{ date: '2026-10-23' }] }, groups: settings.groups, practices: [], appUrl }));
    expect(incomplete).not.toContain('"label":"登録のみ"');
    expect(incomplete).not.toContain('登録して募集');
    expect(incomplete).toContain('"label":"修正して登録"');
  });

  it('確認カード: 延長の表示', () => {
    const json = JSON.stringify(
      confirmCard({
        draft: {
          id: 'd1',
          booker: 'U1',
          items: [
            {
              reservation: { date: '2026-10-21', start: '21:00', end: '22:00', studio: 'worcle', room: 'A', fee: 3000 },
              kind: 'extension',
              targetId: 'worcle-20261021-1900-A',
            },
          ],
          incomplete: [],
          pastCount: 0,
          groups: ['G1'],
          createdAt: '',
        },
        groups: settings.groups,
        practices: [practice()],
        appUrl,
      }),
    );
    expect(json).toContain('10/21 19:00〜21:00の予約情報の延長として更新');
  });

  it('練習一覧', () => {
    expect(practiceListMessage([], appUrl).type).toBe('text');
    const msg = practiceListMessage([{ practice: practice({ status: '満員' }), going: 5 }], appUrl);
    expect(JSON.stringify(msg)).toContain('5人 満員');
    // 上限があれば「参加/上限」で出す
    expect(JSON.stringify(practiceListMessage([{ practice: practice({ max: 12 }), going: 1 }], appUrl))).toContain('"1/12人"');
    expect(JSON.stringify(practiceListMessage([{ practice: practice({ max: 5, status: '満員' }), going: 5 }], appUrl))).toContain('5/5人 満員');
  });

  it('予約情報削除の通知メッセージ', () => {
    const msg = practiceCancellationMessage(
      { date: '2026-11-10', start: '18:00', end: '21:00', studio: 'スタジオノア 渋谷店', room: 'Ast', memo: '自主練' },
      'たろう',
    );
    expect(msg.type).toBe('text');
    expect(msg.text).toContain('【予約の削除連絡】');
    expect(msg.text).toContain('11/10');
    expect(msg.text).toContain('18:00〜21:00');
    expect(msg.text).toContain('スタジオノア 渋谷店 Ast');
    expect(msg.text).toContain('予約者: たろう');
    expect(msg.text).toContain('メモ: 自主練');
  });

  it('予約情報削除時のグループ通知可否と初期値判定', () => {
    const today = '2026-11-02';
    // 未来かつ募集中
    expect(canNotifyPracticeCancellation({ date: '2026-11-10', status: '募集中' }, today)).toBe(true);
    // 満員（アクティブ）も対象
    expect(canNotifyPracticeCancellation({ date: '2026-11-10', status: '満員' }, today)).toBe(true);
    // 当日終了前（現在 10:00、終了 12:00）
    expect(canNotifyPracticeCancellation({ date: '2026-11-02', end: '12:00', status: '募集中' }, today, '10:00')).toBe(true);
    // 当日終了後（現在 15:00、終了 12:00）
    expect(canNotifyPracticeCancellation({ date: '2026-11-02', end: '12:00', status: '募集中' }, today, '15:00')).toBe(false);
    // 過去
    expect(canNotifyPracticeCancellation({ date: '2026-11-01', status: '募集中' }, today)).toBe(false);
    // 中止
    expect(canNotifyPracticeCancellation({ date: '2026-11-10', status: '中止' }, today)).toBe(false);

    // shouldNotifyPracticeCancellation: 募集済グループ有無との連動
    expect(shouldNotifyPracticeCancellation({ date: '2026-11-10', status: '募集中', groups: ['C1'] }, today)).toBe(true);
    expect(shouldNotifyPracticeCancellation({ date: '2026-11-10', status: '募集中', groups: [] }, today)).toBe(false);
    expect(shouldNotifyPracticeCancellation({ date: '2026-11-01', status: '募集中', groups: ['C1'] }, today)).toBe(false);
    expect(shouldNotifyPracticeCancellation({ date: '2026-11-02', end: '12:00', status: '募集中', groups: ['C1'] }, today, '15:00')).toBe(false);
    expect(shouldNotifyPracticeCancellation(null, today)).toBe(false);
  });

  it('自分に関係する練習判定（isMinePractice）とRSVP対象判定（isRsvpTarget）', () => {
    const uid = 'U_ME';
    const ugroups = ['G1', 'G2'];
    const today = '2026-11-02';

    // 1. isMinePractice
    // 予約者本人
    expect(isMinePractice({ practice: { booker: uid, groups: ['G_OTHER'] } }, uid, ugroups)).toBe(true);
    // 所属グループに募集されている
    expect(isMinePractice({ practice: { booker: 'U_OTHER', groups: ['G1'] } }, uid, ugroups)).toBe(true);
    // 回答済み
    expect(isMinePractice({ practice: { booker: 'U_OTHER', groups: ['G_OTHER'] }, myAnswer: '行く' }, uid, ugroups)).toBe(true);
    // 参加履歴あり（involved）
    expect(isMinePractice({ practice: { booker: 'U_OTHER', groups: ['G_OTHER'] }, involved: true }, uid, ugroups)).toBe(true);
    // 全く関係ない
    expect(isMinePractice({ practice: { booker: 'U_OTHER', groups: ['G_OTHER'] }, myAnswer: null, involved: false }, uid, ugroups)).toBe(false);

    // 2. isRsvpTarget
    // 未来・アクティブ・関係あり
    expect(
      isRsvpTarget(
        { practice: { booker: 'U_OTHER', groups: ['G1'], status: '募集中', date: '2026-11-10', end: '20:00' } },
        uid,
        ugroups,
        today,
      ),
    ).toBe(true);
    // 中止は対象外
    expect(
      isRsvpTarget(
        { practice: { booker: 'U_OTHER', groups: ['G1'], status: '中止', date: '2026-11-10', end: '20:00' } },
        uid,
        ugroups,
        today,
      ),
    ).toBe(false);
    // 過去日は対象外
    expect(
      isRsvpTarget(
        { practice: { booker: 'U_OTHER', groups: ['G1'], status: '募集中', date: '2026-10-30', end: '20:00' } },
        uid,
        ugroups,
        today,
      ),
    ).toBe(false);
    // 当日開始後は対象外
    expect(
      isRsvpTarget(
        { practice: { booker: 'U_OTHER', groups: ['G1'], status: '募集中', date: today, start: '13:00', end: '15:00' } },
        uid,
        ugroups,
        today,
        '14:00',
      ),
    ).toBe(false);
    // 当日終了済み（startなしでもendで判定）は対象外
    expect(
      isRsvpTarget(
        { practice: { booker: 'U_OTHER', groups: ['G1'], status: '募集中', date: today, end: '12:00' } },
        uid,
        ugroups,
        today,
        '15:00',
      ),
    ).toBe(false);
    // 当日開始前なら対象
    expect(
      isRsvpTarget(
        { practice: { booker: 'U_OTHER', groups: ['G1'], status: '募集中', date: today, start: '16:00', end: '18:00' } },
        uid,
        ugroups,
        today,
        '15:00',
      ),
    ).toBe(true);
  });

  it('isStartedPractice（予約情報が開始時刻を過ぎているかの判定）', () => {
    const today = '2026-11-02';

    // 過去日は常に開始済み
    expect(isStartedPractice({ date: '2026-11-01', start: '19:00' }, today)).toBe(true);
    expect(isStartedPractice({ date: '2026-11-01' }, today)).toBe(true);

    // 未来日は常に未開始
    expect(isStartedPractice({ date: '2026-11-03', start: '10:00' }, today)).toBe(false);
    expect(isStartedPractice({ date: '2026-11-03' }, today)).toBe(false);

    // 当日: 開始時刻ちょうど（<= で開始済み）
    expect(isStartedPractice({ date: today, start: '14:00' }, today, '14:00')).toBe(true);

    // 当日: 開始時刻超過
    expect(isStartedPractice({ date: today, start: '14:00' }, today, '14:01')).toBe(true);

    // 当日: 開始前
    expect(isStartedPractice({ date: today, start: '14:00' }, today, '13:59')).toBe(false);

    // 当日: start がなく end だけの場合は end で判定
    expect(isStartedPractice({ date: today, end: '16:00' }, today, '16:00')).toBe(true);
    expect(isStartedPractice({ date: today, end: '16:00' }, today, '15:30')).toBe(false);

    // 当日: currentTime が未指定の場合は false（当日の練習は開始済み扱いしない）
    expect(isStartedPractice({ date: today, start: '14:00' }, today)).toBe(false);
  });

  it('開始を変えたら、終了を開始の1時間後より前にしない', () => {
    expect(endAfterStart('21:00', '21:00')).toBe('22:00');
    expect(endAfterStart('20:30', '21:00')).toBe('21:30');
    expect(endAfterStart('18:00', '21:00')).toBe('21:00');
    expect(endAfterStart('9:00', '')).toBe('10:00');
    // 日をまたぐ時刻は入力欄で表せないので変えない
    expect(endAfterStart('23:30', '23:45')).toBe('23:45');
    expect(endAfterStart('', '21:00')).toBe('21:00');
  });

  it('postbackの往復', () => {
    expect(parsePostback('a=rsvp&p=BUZZ%E6%A8%AA%E6%B5%9C-20261021-1900-A&v=1')).toEqual({
      a: 'rsvp',
      p: 'BUZZ横浜-20261021-1900-A',
      v: '1',
    });
  });
});
