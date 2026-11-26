import type {ReactNode} from "react"

import {VersionBadge} from "@agenta/ui/components/presentational"
import Link from "next/link"

const CHIP =
    "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-solid border-border bg-muted/40 px-2 py-0.5 text-sm text-foreground no-underline"

/**
 * A test set, application or variant in the run summary: an icon, the name, the version when
 * there is one, and a link when its page is on.
 */
export const RunReferenceChip = ({
    icon,
    label,
    version,
    href,
}: {
    icon: ReactNode
    label: string
    version?: number | null
    href?: string | null
}) => {
    const body = (
        <>
            <span aria-hidden className="inline-flex shrink-0 text-muted-foreground">
                {icon}
            </span>
            <span className="truncate">{label}</span>
            {version !== null && version !== undefined ? (
                <VersionBadge version={version} variant="chip" size="small" />
            ) : null}
        </>
    )
    return href ? (
        <Link href={href} prefetch={false} className={`${CHIP} hover:bg-muted`}>
            {body}
        </Link>
    ) : (
        <span className={CHIP}>{body}</span>
    )
}
