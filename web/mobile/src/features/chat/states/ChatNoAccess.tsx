import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {LockSimpleIcon} from "@phosphor-icons/react"
import Link from "next/link"

import {sharingCopy} from "@/lib/sharingCopy"

/**
 * A chat the reader cannot open. `not_found` is the same page for a private and an unknown chat,
 * so it never tells which one it was. `removed` replaces a transcript that was on screen when
 * the owner took the reader's access away.
 */
export const ChatNoAccess = ({
    kind,
    sessionsHref,
}: {
    kind: "not_found" | "removed"
    sessionsHref: string
}) => (
    <Empty className="m-auto py-16" data-testid={`chat-no-access-${kind}`}>
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <LockSimpleIcon />
            </EmptyMedia>
            {kind === "removed" ? (
                <>
                    <EmptyTitle>{sharingCopy.accessRemovedTitle}</EmptyTitle>
                    <EmptyDescription>{sharingCopy.accessRemovedBody}</EmptyDescription>
                </>
            ) : (
                <EmptyDescription>{sharingCopy.chatNotFound}</EmptyDescription>
            )}
        </EmptyHeader>
        <EmptyContent>
            <Button variant="outline" size="sm" asChild>
                <Link href={sessionsHref}>{sharingCopy.backToSessions}</Link>
            </Button>
        </EmptyContent>
    </Empty>
)
