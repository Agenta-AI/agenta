import {useCallback, useEffect, useRef, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {CaretDown, Check, Copy} from "@phosphor-icons/react"

type CopyKind = "id" | "slug"

/** The key the old app used, so a reader keeps the choice they made there. */
export const LAST_COPY_KEY = "testcase-header-last-copy-action"
const COPIED_MS = 2000

const readLastKind = (): CopyKind => {
    try {
        return window.localStorage.getItem(LAST_COPY_KEY) === "slug" ? "slug" : "id"
    } catch {
        return "id"
    }
}

const writeLastKind = (kind: CopyKind) => {
    try {
        window.localStorage.setItem(LAST_COPY_KEY, kind)
    } catch {
        // The choice is a convenience; a blocked store only forgets it.
    }
}

/**
 * Copies the revision id or its slug. The main button repeats the last choice and the menu
 * picks the other one. The slug is off while the revision has none.
 */
export const TestsetCopyControl = ({
    revisionId,
    revisionSlug,
}: {
    revisionId: string | null
    revisionSlug: string | undefined
}) => {
    const [kind, setKind] = useState<CopyKind>("id")
    const [copied, setCopied] = useState(false)
    const timer = useRef<number | undefined>(undefined)

    // The saved choice is read after mount: the server render has no storage.
    useEffect(() => {
        setKind(readLastKind())
        return () => window.clearTimeout(timer.current)
    }, [])

    const copy = useCallback(
        async (next: CopyKind) => {
            const text = next === "slug" ? revisionSlug : revisionId
            if (!text) return
            setKind(next)
            writeLastKind(next)
            if (!(await copyToClipboard(text))) {
                message.error("Couldn't copy")
                return
            }
            message.success(
                next === "slug"
                    ? "Revision slug copied to clipboard"
                    : "Revision ID copied to clipboard",
            )
            setCopied(true)
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
        },
        [revisionId, revisionSlug],
    )

    const effectiveKind: CopyKind = kind === "slug" && !revisionSlug ? "id" : kind
    const disabled = !revisionId

    return (
        <div className="inline-flex shrink-0 items-center">
            <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => void copy(effectiveKind)}
                className="gap-1.5 rounded-r-none"
            >
                {copied ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
                {copied ? "Copied!" : effectiveKind === "slug" ? "Slug" : "ID"}
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        disabled={disabled}
                        aria-label="More copy options"
                        className="-ml-px rounded-l-none"
                    >
                        <CaretDown aria-hidden size={12} />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void copy("id")}>Copy ID</DropdownMenuItem>
                    <DropdownMenuItem disabled={!revisionSlug} onSelect={() => void copy("slug")}>
                        Copy Revision Slug
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
