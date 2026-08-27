import {useCallback, useRef, useState} from "react"

import {message} from "@agenta/ui/app-message"

export interface InlineRenameOptions {
    /** The name as it stands, used to seed the draft and to skip a no-op commit. */
    current: string | null | undefined
    /** Persists the new name. `false` surfaces an error and leaves the row alone. */
    onCommit: (name: string) => Promise<boolean>
}

export interface InlineRename {
    renaming: boolean
    draft: string
    setDraft: (value: string) => void
    /** Enter the editing state, seeded from `current`. */
    start: () => void
    /** Save, unless the draft is blank or unchanged. Safe to call twice — blur then Enter. */
    commit: () => Promise<void>
    /** Leave without saving. */
    cancel: () => void
}

/**
 * The rename-in-place state machine, shared by every surface that lists sessions.
 *
 * Extracted from the nav rail so the sessions page and the mobile list can rename the same way
 * rather than each reimplementing it — and so the modal none of them needed can go. Commit is
 * guarded by a ref, not by state: blur fires before keydown, so Enter would otherwise save a
 * second time against a row that has already left the editing state.
 */
export const useInlineRename = ({current, onCommit}: InlineRenameOptions): InlineRename => {
    const [renaming, setRenaming] = useState(false)
    const [draft, setDraft] = useState("")
    const committedRef = useRef(false)

    const start = useCallback(() => {
        committedRef.current = false
        setDraft(current ?? "")
        setRenaming(true)
    }, [current])

    const cancel = useCallback(() => {
        committedRef.current = true
        setRenaming(false)
    }, [])

    const commit = useCallback(async () => {
        if (committedRef.current) return
        committedRef.current = true
        const name = draft.trim()
        setRenaming(false)
        if (!name || name === (current ?? "")) return
        if (!(await onCommit(name))) message.error("Couldn't rename this session")
    }, [current, draft, onCommit])

    return {renaming, draft, setDraft, start, commit, cancel}
}
