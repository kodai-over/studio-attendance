import { describe, expect, it, vi } from 'vitest';
import { MyAnswerBadge, readTab } from '../src/pages/List';
import { NavBar, RsvpButtons, go, setNavigationGuard } from '../src/ui';

describe('MyAnswerBadge（予定一覧・詳細の回答ステータスバッジ）', () => {
  it('行く（○）のバッジが正しく返る', () => {
    const vnode = MyAnswerBadge({ answer: '行く' });
    expect(vnode.props['aria-label']).toBe('行く');
    expect(vnode.props.children).toBe('○');
    expect(vnode.props.class).toContain('going');
  });

  it('保留（△）のバッジが正しく返る', () => {
    const vnode = MyAnswerBadge({ answer: '保留' });
    expect(vnode.props['aria-label']).toBe('未定');
    expect(vnode.props.children).toBe('△');
    expect(vnode.props.class).toContain('maybe');
  });

  it('行かない（✕）のバッジが正しく返る', () => {
    const vnode = MyAnswerBadge({ answer: '行かない' });
    expect(vnode.props['aria-label']).toBe('行かない');
    expect(vnode.props.children).toBe('✕');
    expect(vnode.props.class).toContain('not-going');
  });

  it('未回答（—）のバッジが正しく返る', () => {
    const vnode = MyAnswerBadge({ answer: null });
    expect(vnode.props['aria-label']).toBe('未回答');
    expect(vnode.props.children).toBe('—');
    expect(vnode.props.class).toContain('none');
  });
});

describe('readTab（予定一覧タブの互換性維持）', () => {
  it('古い未定タブ（todo）が残っていても、安全に「all（すべて）」へ戻す', () => {
    const store = new Map<string, string>();
    const originalLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      length: 0,
      key: () => null,
    };

    try {
      localStorage.setItem('pb:tab', 'todo');
      expect(readTab()).toBe('all');

      localStorage.setItem('pb:tab', 'mine');
      expect(readTab()).toBe('mine');

      localStorage.setItem('pb:tab', 'all');
      expect(readTab()).toBe('all');
    } finally {
      globalThis.localStorage = originalLocalStorage;
    }
  });
});

describe('RsvpButtons（回答選択ボタン）', () => {
  it('満員の予約情報で未回答の場合、「行く」ボタンは disabled ではなく押下時に onBlocked("full") が呼ばれる', () => {
    const handleAnswer = vi.fn();
    const handleBlocked = vi.fn();

    const vnode = RsvpButtons({
      value: null,
      status: '満員',
      onAnswer: handleAnswer,
      onBlocked: handleBlocked,
    });

    const buttons = vnode.props.children as Array<{
      props: {
        class: string;
        disabled?: boolean;
        onClick: () => void;
      };
    }>;
    expect(buttons).toHaveLength(3);

    const [yesBtn, maybeBtn, noBtn] = buttons;

    // 「行く」ボタン: disabled は false で、is-blocked-full クラスが付与される
    expect(yesBtn.props.disabled).toBeFalsy();
    expect(yesBtn.props.class).toContain('is-blocked-full');

    // 「行く」をクリックしたとき、onBlocked('full') が呼ばれ、onAnswer は呼ばれない
    yesBtn.props.onClick();
    expect(handleBlocked).toHaveBeenCalledWith('full');
    expect(handleAnswer).not.toHaveBeenCalled();

    // 「保留」や「行かない」は通常どおり onAnswer が呼ばれる
    maybeBtn.props.onClick();
    expect(handleAnswer).toHaveBeenCalledWith('保留');

    noBtn.props.onClick();
    expect(handleAnswer).toHaveBeenCalledWith('行かない');
  });

  it('自分がすでに「行く」を選択済みの場合は満員でもブロックされない', () => {
    const handleAnswer = vi.fn();
    const handleBlocked = vi.fn();

    const vnode = RsvpButtons({
      value: '行く',
      status: '満員',
      onAnswer: handleAnswer,
      onBlocked: handleBlocked,
    });

    const buttons = vnode.props.children as Array<{
      props: {
        class: string;
        disabled?: boolean;
        onClick: () => void;
      };
    }>;
    const [yesBtn] = buttons;
    expect(yesBtn.props.class).not.toContain('is-blocked-full');
  });

  it('中止または終了の予約情報では全ボタンが disabled になる', () => {
    const vnode = RsvpButtons({
      value: null,
      status: '中止',
      onAnswer: vi.fn(),
    });

    const buttons = vnode.props.children as Array<{
      props: {
        disabled?: boolean;
      };
    }>;
    for (const btn of buttons) {
      expect(btn.props.disabled).toBe(true);
    }
  });
});

describe('NavigationGuard（ui.tsx の画面遷移ガード）', () => {
  it('ガードが false を返した場合、go() による遷移が阻止される', () => {
    const originalLocation = globalThis.location;
    globalThis.location = { hash: '#/answer' } as Location;
    try {
      const guard = vi.fn().mockReturnValue(false);
      setNavigationGuard(guard);

      go('/settings');

      expect(guard).toHaveBeenCalledWith('/settings');
      expect(location.hash).toBe('#/answer');
    } finally {
      setNavigationGuard(null);
      globalThis.location = originalLocation;
    }
  });

  it('ガードが true を返した場合、go() による遷移が実行される', () => {
    const originalLocation = globalThis.location;
    globalThis.location = { hash: '#/answer' } as Location;
    try {
      const guard = vi.fn().mockReturnValue(true);
      setNavigationGuard(guard);

      go('/settings');

      expect(guard).toHaveBeenCalledWith('/settings');
      expect(location.hash).toBe('/settings');
    } finally {
      setNavigationGuard(null);
      globalThis.location = originalLocation;
    }
  });
});
