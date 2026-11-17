import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "mishwark-theme";

const read = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

/** Light by default; each person's choice is kept on their device. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}
