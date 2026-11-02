import { describe, expect, it } from 'vitest';
import { MyAnswerBadge } from '../src/pages/List';

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
