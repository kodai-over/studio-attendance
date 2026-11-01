export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'pb:theme';

export function getTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  return 'system';
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  } else {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }
}

/** アプリ初期化時にテーマを適用 */
export function initTheme() {
  applyTheme(getTheme());
}
