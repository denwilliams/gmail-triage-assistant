import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { effectiveTheme, setTheme, theme } = useTheme();

  const handleCycleTheme = () => {
    const themes: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];
    const currentIndex = themes.indexOf(theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    setTheme(nextTheme);
  };

  return (
    <button
      onClick={handleCycleTheme}
      className={cn(
        "inline-flex items-center justify-center rounded-md p-2 transition-colors",
        "text-muted-foreground hover:text-foreground hover:bg-accent"
      )}
      title={`Theme: ${theme}`}
      aria-label="Toggle theme"
    >
      {effectiveTheme === "dark" ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
    </button>
  );
}
