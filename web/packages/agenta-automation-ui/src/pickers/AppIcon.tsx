import {Skeleton} from "@agenta/ui/ui"

/**
 * An app's mark at row size.
 *
 * Three states, and the middle one matters: while the integrations catalog is still answering
 * there is no logo *yet*, which is not the same as an app that has none. Showing the letter tile
 * during the load made every row flash a placeholder that looked like a broken icon.
 */
export const AppIcon = ({
    logo,
    label,
    loading = false,
}: {
    logo?: string | null
    label: string
    loading?: boolean
}) => {
    if (logo) {
        return (
            <img
                src={logo}
                alt=""
                aria-hidden
                className="size-4 shrink-0 rounded-[3px] object-contain"
            />
        )
    }
    if (loading) return <Skeleton className="size-4 shrink-0 rounded-[3px]" />
    return (
        <span
            aria-hidden
            className="flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-muted text-[9px] font-medium uppercase text-muted-foreground"
        >
            {label.trim().charAt(0) || "?"}
        </span>
    )
}
