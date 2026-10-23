export const THEME_STORAGE_KEY = "datoko.theme.v1";
export type Theme = "system" | "light" | "dark";

export function parseTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

// Apply before paint, including the class used by shadcn's dark variants.
export const themeInitScript = '(()=>{const root=document.documentElement;const media=matchMedia("(prefers-color-scheme: dark)");let theme="system";try{const saved=localStorage.getItem("datoko.theme.v1");if(saved==="light"||saved==="dark")theme=saved;}catch{}root.dataset.theme=theme;const apply=()=>root.classList.toggle("dark",root.dataset.theme==="dark"||(root.dataset.theme==="system"&&media.matches));apply();media.addEventListener("change",apply);window.addEventListener("datoko:theme-change",apply);})();';
