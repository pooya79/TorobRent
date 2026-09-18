export function ChoiceButtons({
  label,
  name,
  value,
  options,
  onChange,
  compact = false,
}: {
  compact?: boolean;
  label: string;
  name: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className={compact ? "min-w-0 space-y-1.5" : "min-w-0 space-y-3"}>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([key, text]) => (
          <label
            key={key}
            className={`text-muted-foreground has-checked:bg-primary/10 has-checked:text-primary has-focus-visible:ring-ring hover:bg-muted flex cursor-pointer items-center text-sm transition-colors has-focus-visible:ring-2 ${compact ? "min-h-9 rounded-md px-3" : "border-border has-checked:border-primary min-h-11 rounded-xl border px-4"}`}
          >
            <input
              className="sr-only"
              type="radio"
              name={name}
              value={key}
              checked={value === key}
              onChange={() => onChange(key)}
            />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
