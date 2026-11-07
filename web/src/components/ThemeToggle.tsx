import { useTheme } from "../lib/theme";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] text-[var(--axon-muted)] hover:text-[var(--axon-text)] transition"
      title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
      aria-label="Toggle Theme"
    >
      {theme === "dark" ? (
        // Sun Icon
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 text-amber-400">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        // Moon Icon
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 text-indigo-500">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
