interface ThemeToggleProps {
    mode: "light" | "dark"
    onChange: (mode: "light" | "dark") => void
}

export function ThemeToggle({mode, onChange}: ThemeToggleProps) {
    return (
        <div role="group" aria-label="Mode" className="inline-flex gap-0.5 rounded-[var(--radius-md)] bg-secondary p-0.5">
            {(["light", "dark"] as const).map((m) => (
                <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => onChange(m)}
                    className="h-6 rounded-[var(--radius-sm)] px-3 text-xs font-medium capitalize text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground"
                >
                    {m}
                </button>
            ))}
        </div>
    )
}
