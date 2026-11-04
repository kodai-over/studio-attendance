/**
 * docs/design.md の決まりが崩れていないかを確かめる。
 * 色・文字の大きさ・角丸は決まり（トークン）からだけ選び、画面の部品はクラスで見た目を決める。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'src/styles.css'), 'utf8');

/** 決まり（トークン）を定義している塊。ここだけは色などの値を直接書いてよい */
const TOKEN_BLOCK_START = /^(:root \{|\s*:root:not\(\[data-theme='light'\]\) \{|:root\[data-theme='dark'\] \{)/;

/** トークンの塊の外にある行（行番号つき） */
function linesOutsideTokens(): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  let inside = false;
  css.split('\n').forEach((text, i) => {
    if (TOKEN_BLOCK_START.test(text)) inside = true;
    else if (inside && /^\s*\}\s*$/.test(text)) inside = false;
    else if (!inside) out.push({ n: i + 1, text });
  });
  return out;
}

function tsxFiles(dir = join(root, 'src')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

describe('デザインの決まり（docs/design.md）', () => {
  it('色はトークンの塊の中でだけ決める（ほかの所では var(--…) を使う）', () => {
    const bad = linesOutsideTokens().filter(({ text }) => {
      // 切り込みの形を作るマスクの #000 と、select の矢印画像（data URL）は色ではないので除く
      if (/mask:|data:image|transparent 7\.5px, #000/.test(text)) return false;
      return /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(text);
    });
    expect(bad.map((l) => `styles.css:${l.n} ${l.text.trim()}`)).toEqual([]);
  });

  it('文字の大きさは --fs-* から選ぶ', () => {
    const bad = linesOutsideTokens().filter(({ text }) => /font-size:/.test(text) && !/font-size:\s*var\(--fs-/.test(text));
    expect(bad.map((l) => `styles.css:${l.n} ${l.text.trim()}`)).toEqual([]);
  });

  it('角丸は --r-* から選ぶ（丸は 50%、角なしは 0）', () => {
    const bad = linesOutsideTokens().filter(({ text }) => {
      const m = text.match(/border-radius:\s*([^;]+);/);
      if (!m) return false;
      return !m[1].split(/\s+/).every((v) => v === '0' || v === '50%' || /var\(--r-/.test(v) || /^calc\(var\(--r-/.test(v) || /^-|\)$/.test(v));
    });
    expect(bad.map((l) => `styles.css:${l.n} ${l.text.trim()}`)).toEqual([]);
  });

  it('使っている変数（var(--…)）はすべて定義されている', () => {
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    // 画面側から style で渡す変数（引っ張って更新の量）
    const fromScript = new Set(['--pull', '--progress']);
    expect([...used].filter((v) => !defined.has(v) && !fromScript.has(v))).toEqual([]);
  });

  it('変数の定義が自分自身や互いを参照し合っていない（循環すると値が無効になる）', () => {
    // 名前 → 定義の中で参照している変数（ライト・ダークのどの塊の定義も含める）
    const refs = new Map<string, Set<string>>();
    for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      const set = refs.get(m[1]) ?? new Set<string>();
      for (const r of m[2].matchAll(/var\((--[\w-]+)/g)) set.add(r[1]);
      refs.set(m[1], set);
    }
    const cycles: string[] = [];
    const visit = (name: string, path: string[]) => {
      for (const next of refs.get(name) ?? []) {
        if (next === path[0]) cycles.push([...path, next].join(' → '));
        else if (!path.includes(next)) visit(next, [...path, next]);
      }
    };
    for (const name of refs.keys()) visit(name, [name]);
    expect(cycles).toEqual([]);
  });

  it('画面の部品に色を直接書かない', () => {
    const bad = tsxFiles().flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((text, i) => ({ f, n: i + 1, text }))
        .filter(({ text }) => /['"`]#[0-9a-fA-F]{3,8}\b/.test(text)),
    );
    expect(bad.map((l) => `${relative(root, l.f)}:${l.n}`)).toEqual([]);
  });

  it('インラインスタイル（style=）は、動きに合わせて値が変わる所だけに使う', () => {
    // 指の動きに合わせて動かすスワイプと、引っ張った量を渡す「引っ張って更新」だけ
    const allowed: Record<string, number> = { 'src/pages/RecruitList.tsx': 1, 'src/ui.tsx': 1 };
    const counts = Object.fromEntries(
      tsxFiles()
        .map((f) => [relative(root, f), (readFileSync(f, 'utf8').match(/\bstyle=\{/g) ?? []).length] as const)
        .filter(([, n]) => n > 0),
    );
    expect(counts).toEqual(allowed);
  });
});
