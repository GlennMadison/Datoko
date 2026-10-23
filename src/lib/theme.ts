export const THEME_STORAGE_KEY = "datoko.theme.v1";
export type Theme = "system" | "light" | "dark";

export function parseTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

// Run in <head> before paint. CSS resolves System and follows OS changes live.
// Only a validated enum is assigned; no stored content is inserted into HTML.
export const themeInitScript = `(()=>{let theme="system";try{const saved=localStorage.getItem("${THEME_STORAGE_KEY}");if(saved==="light"||saved==="dark")theme=saved;}catch{}document.documentElement.dataset.theme=theme;})();`;
