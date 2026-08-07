export const SessionSearchBar = ({
    value,
    onChange,
}: {
    value: string
    onChange: (value: string) => void
}) => (
    <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search sessions"
        className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 text-base"
    />
)
