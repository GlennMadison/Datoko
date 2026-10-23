"use client";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";


import { useSyncExternalStore } from "react";
import { parseTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

const themeChangeEvent = "datoko:theme-change";
const getSnapshot = () => parseTheme(document.documentElement.dataset.theme);
const getServerSnapshot = (): Theme => "system";

function subscribe(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    document.documentElement.dataset.theme = parseTheme(event.newValue);
    window.dispatchEvent(new Event(themeChangeEvent));
    onChange();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener(themeChangeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(themeChangeEvent, onChange);
  };
}

function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Keep the choice for this page if storage is blocked. */ }
  window.dispatchEvent(new Event(themeChangeEvent));
}

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return <label className="theme-switcher">
    <span className="sr-only">Theme</span>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/></svg>
    <NativeSelect aria-label="Theme" title="Theme" value={theme} onChange={event => setTheme(parseTheme(event.target.value))}>
      <NativeSelectOption value="system">System</NativeSelectOption>
      <NativeSelectOption value="light">Light</NativeSelectOption>
      <NativeSelectOption value="dark">Dark</NativeSelectOption>
    </NativeSelect>
  </label>;
}
