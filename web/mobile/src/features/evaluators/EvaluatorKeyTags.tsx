/**
 * The first three names as small tags, then "+N". Template categories and feedback keys use it.
 * With no names it still draws its cell: a row is a grid, and a missing cell would shift every
 * column after it one track to the left.
 */
export const EvaluatorKeyTags = ({names}: {names: readonly string[]}) => {
    if (names.length === 0) return <span />
    return (
        <span className="flex min-w-0 flex-wrap items-center gap-1 overflow-hidden">
            {names.slice(0, 3).map((name) => (
                <span
                    key={name}
                    className="max-w-[120px] truncate rounded-sm bg-muted px-1.5 py-0.5 text-[12px] leading-4 text-foreground"
                    title={name}
                >
                    {name}
                </span>
            ))}
            {names.length > 3 ? (
                <span className="text-[12px] text-muted-foreground">+{names.length - 3}</span>
            ) : null}
        </span>
    )
}
