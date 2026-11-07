import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light" | "system";

const STORAGE_KEY = "axon_theme";

export function getInitialTheme(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
  if (saved === "dark" || saved === "light" || saved === "system") {
    return saved;
  }
  return "dark"; // Default to dark theme as specified
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  let resolved: "dark" | "light" = "dark";

  if (mode === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } else {
    resolved = mode;
  }

  root.setAttribute("data-theme", resolved);
  if (resolved === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.add("light");
    root.classList.remove("dark");
  }
  localStorage.setItem(STORAGE_KEY, mode);
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    applyTheme(mode);
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return { theme, setTheme, toggleTheme };
}
