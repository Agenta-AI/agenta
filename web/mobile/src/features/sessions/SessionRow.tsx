import type {SessionStream} from "@agenta/entities/session"
import Link from "next/link"

/** Raw relative time ("3h ago") — enough for the LITE phase, no dayjs. */
const timeAgo = (iso: string | null | undefined): string | null => {
    if (!iso) return null
    const then = Date.parse(iso)
    if (Number.isNaN(then)) return null
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
    if (seconds < 60) return "just now"
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
}

export const SessionRow = ({session, href}: {session: SessionStream; href: string}) => {
    const agentLabel = session.references?.[0]?.slug ?? session.references?.[0]?.id ?? "—"
    const activity = timeAgo(session.updated_at ?? session.created_at)
    return (
        <Link href={href} className="border-border flex flex-col gap-0.5 border-b px-4 py-3">
            <span className="text-xs font-medium">
                {session.name ?? "Untitled session"}
                {session.flags?.is_alive ? (
                    <span className="text-muted-foreground ml-2 font-normal">live</span>
                ) : null}
                {session.deleted_at ? (
                    <span className="text-muted-foreground ml-2 font-normal">ended</span>
                ) : null}
            </span>
            <span className="text-muted-foreground text-xs">
                {agentLabel}
                {activity ? ` · ${activity}` : ""}
            </span>
        </Link>
    )
}
