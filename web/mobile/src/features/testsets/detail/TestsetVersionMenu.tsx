import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretDown, Check} from "@phosphor-icons/react"

import {formatTestsetDate} from "../list/formatTestsetDate"

import type {RevisionsList} from "./useRevisionsList"

/**
 * The version button and the revisions behind it. The list loads on the first open, and the
 * menu says which wait it is: not asked yet, loading, or nothing to show.
 */
export const TestsetVersionMenu = ({
    version,
    currentRevisionId,
    list,
    onPick,
}: {
    version: number | undefined
    currentRevisionId: string | null
    list: Pick<RevisionsList, "revisions" | "status" | "load">
    onPick: (revisionId: string) => void
}) => (
    <DropdownMenu onOpenChange={(open) => (open ? list.load() : undefined)}>
        <DropdownMenuTrigger asChild>
            <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label="Choose a version"
                className="shrink-0 gap-1 font-medium"
            >
                v{version ?? "#"}
                <CaretDown aria-hidden size={12} />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] w-[min(320px,90vw)]">
            <VersionMenuBody list={list} currentRevisionId={currentRevisionId} onPick={onPick} />
        </DropdownMenuContent>
    </DropdownMenu>
)

const VersionMenuBody = ({
    list,
    currentRevisionId,
    onPick,
}: {
    list: Pick<RevisionsList, "revisions" | "status">
    currentRevisionId: string | null
    onPick: (revisionId: string) => void
}) => {
    if (list.status === "idle") return <MenuNote>Loading revisions...</MenuNote>
    if (list.status === "loading") return <MenuNote>Loading...</MenuNote>
    if (list.status === "error") return <MenuNote>Revisions did not load</MenuNote>
    if (list.revisions.length === 0) return <MenuNote>No revisions found</MenuNote>
    return (
        <>
            {list.revisions.map((revision) => (
                <DropdownMenuItem
                    key={revision.id}
                    onSelect={() => onPick(revision.id)}
                    className="flex-col items-stretch gap-0.5"
                >
                    <span className="flex items-center gap-2">
                        <span className="font-medium">v{revision.version}</span>
                        <span className="text-xs text-muted-foreground">
                            {formatTestsetDate(revision.createdAt)}
                        </span>
                        {revision.id === currentRevisionId ? (
                            <Check aria-label="Current version" size={12} className="ml-auto" />
                        ) : null}
                    </span>
                    {revision.message ? (
                        <span className="truncate text-xs text-muted-foreground">
                            {revision.message}
                        </span>
                    ) : null}
                    {revision.authorId ? (
                        <span className="truncate text-xs text-muted-foreground">
                            <UserAuthorLabel userId={revision.authorId} fallback="" />
                        </span>
                    ) : null}
                </DropdownMenuItem>
            ))}
        </>
    )
}

const MenuNote = ({children}: {children: string}) => (
    <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">{children}</p>
)
