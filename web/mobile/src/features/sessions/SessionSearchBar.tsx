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
        // text-base is deliberate: iOS zooms the viewport on focus below 16px.
        className="border-border bg-background text-foreground placeholder:text-muted-foreground min-w-0 flex-1 rounded-md border px-3 py-1.5 text-base"
    />
)
