import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "torobrent-theme";

export const THEME_COLORS = {
  light: "#ffffff",
  dark: "#121214",
} as const;

export const THEME_BOOTSTRAP_SCRIPT = `(()=>{try{const p=localStorage.getItem("${THEME_STORAGE_KEY}");const v=p==="light"||p==="dark"||p==="system"?p:"system";if(v==="system")document.documentElement.removeAttribute("data-theme");else document.documentElement.dataset.theme=v;const d=v==="dark"||(v==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.querySelectorAll('meta[name="theme-color"]').forEach((m)=>m.content=d?"${THEME_COLORS.dark}":"${THEME_COLORS.light}")}catch{document.documentElement.removeAttribute("data-theme")}})();`;

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const themeSubscribers = new Set<() => void>();
let volatilePreference: ThemePreference | null = null;

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return volatilePreference ?? "system";
  }
}

function systemPrefersDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function applyPreference(preference: ThemePreference, transition: boolean) {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.dataset.theme = preference;
  }

  const resolved =
    preference === "system"
      ? systemPrefersDark()
        ? "dark"
        : "light"
      : preference;
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )) {
    meta.content = THEME_COLORS[resolved];
  }

  if (transition) {
    root.dataset.themeTransition = "";
    window.setTimeout(() => {
      root.removeAttribute("data-theme-transition");
    }, 180);
  }
}

function subscribeToTheme(onChange: () => void) {
  themeSubscribers.add(onChange);
  const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  const handleSystemChange = () => {
    if (readStoredPreference() === "system") applyPreference("system", false);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const next = isThemePreference(event.newValue) ? event.newValue : "system";
    applyPreference(next, false);
    onChange();
  };

  colorScheme?.addEventListener("change", handleSystemChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    themeSubscribers.delete(onChange);
    colorScheme?.removeEventListener("change", handleSystemChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore<ThemePreference>(
    subscribeToTheme,
    readStoredPreference,
    () => "system",
  );

  useEffect(() => {
    applyPreference(preference, false);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    volatilePreference = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      volatilePreference = null;
    } catch {
      // Storage can be unavailable in privacy modes; the in-memory choice still applies.
    }
    applyPreference(next, true);
    themeSubscribers.forEach((notify) => notify());
  }, []);

  const value = useMemo(
    () => ({ preference, setPreference }),
    [preference, setPreference],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
