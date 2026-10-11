// Lightweight i18n: zh / en dictionaries + React context.
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { zh, type Dict } from "./zh";
import { en } from "./en";

export type Lang = "zh" | "en";
export type { Dict };

const dicts: Record<Lang, Dict> = { zh, en };
const STORAGE_KEY = "layercut.lang";

// current language, mirrored outside React so non-component modules
// (e.g. import notices) can localize without hooks
let currentLang: Lang = "zh";

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* ignore */
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: keyof Dict) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);
  currentLang = lang;

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback((key: keyof Dict) => dicts[lang][key] ?? String(key), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

/** Translate outside React components (store/module code). */
export function getT(): (key: keyof Dict) => string {
  return (key) => dicts[currentLang][key] ?? String(key);
}
