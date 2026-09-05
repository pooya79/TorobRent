export function ChoiceButtons({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([key, text]) => (
          <label
            key={key}
            className="border-border text-muted-foreground has-checked:border-primary has-checked:bg-primary/10 has-checked:text-primary has-focus-visible:ring-ring hover:bg-muted flex min-h-11 cursor-pointer items-center rounded-xl border px-4 text-sm transition-colors has-focus-visible:ring-2"
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
