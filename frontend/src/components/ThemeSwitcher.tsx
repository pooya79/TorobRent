import { Monitor, Moon, Sun } from "lucide-react";

import { type ThemePreference, useTheme } from "@/app/ThemeProvider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

const themeOptions = [
  { value: "system", label: "سیستم", icon: Monitor },
  { value: "light", label: "روشن", icon: Sun },
  { value: "dark", label: "تیره", icon: Moon },
] as const;

export function ThemeSwitcher() {
  const { preference, setPreference } = useTheme();
  const selected = themeOptions.find((option) => option.value === preference)!;
  const SelectedIcon = selected.icon;

  return (
    <Select
      dir="rtl"
      value={preference}
      onValueChange={(value) => setPreference(value as ThemePreference)}
    >
      <SelectTrigger
        aria-label={`پوسته نمایش: ${selected.label}`}
        className="size-11 w-11 justify-center p-0 [&>svg]:hidden"
      >
        <span className="flex items-center justify-center">
          <SelectedIcon className="size-4" aria-hidden="true" />
        </span>
      </SelectTrigger>
      <SelectContent align="start">
        {themeOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
