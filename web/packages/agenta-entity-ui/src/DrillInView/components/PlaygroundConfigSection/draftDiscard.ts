/**
 * Telling a discard apart from the other two ways a draft goes empty.
 *
 * The configuration form remounts itself when the person discards their edits, because editor
 * state (Lexical, local control state) does not reset from props alone. Remounting tears down
 * everything rendered inside the form, including any drawer open over it, so it must happen for
 * a discard and for nothing else.
 *
 * Two other events empty a draft, and neither is a discard:
 *
 * - A revision SWITCH. Moving from a drafted revision to a clean one flips the flag false→true
 *   with no draft ever cleared. Remounting there replayed the sections' entrance for a plain
 *   switch.
 * - A COMMIT. It turns the edits into a new revision and clears the draft they came from. On a
 *   host that switches to the new revision inside the commit this is invisible, because the
 *   revision id has already changed by then. On one that follows the switch afterwards — `/m`,
 *   which registers no `onNewRevision` callback and moves from the auto-commit handler once the
 *   commit resolves — the clearing lands while the old revision is still on screen and reads
 *   exactly like a discard. That is how a drawer nobody had touched closed itself a second or
 *   two after an auto-commit the person never asked for (D94).
 *
 * The emptied value is the same in all three cases, so the caller carries the two facts that
 * separate them: the revision the draft belonged to, and a per-revision count of commits that
 * have consumed a draft.
 */

export interface DraftTracker {
    /** The revision the draft belongs to. A change here is a switch, not a discard. */
    revisionId: string
    /** Whether the draft is empty right now. */
    isDraftEmpty: boolean
    /** How many commits have consumed a draft on this revision. A change here is a commit. */
    draftConsumed: number
}

/**
 * Whether the move from `previous` to `current` is the person discarding their edits.
 *
 * True only when the draft emptied on the revision it belonged to and no commit consumed it.
 */
export function isDraftDiscard(previous: DraftTracker, current: DraftTracker): boolean {
    return (
        previous.revisionId === current.revisionId &&
        current.isDraftEmpty &&
        !previous.isDraftEmpty &&
        previous.draftConsumed === current.draftConsumed
    )
}
