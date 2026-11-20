import {useContext, useMemo, useState} from "react"

import {
    ChangeResultRows,
    type ChangeResultActions,
    type ChangeVersionRef,
} from "@agenta/chat/components"
import {useT} from "@agenta/i18n"
import chatChangeCardStatesCatalog from "@agenta/i18n/catalogs/chat.changeCardStates"
import {
    openAgentVersionHistoryAtom,
    selectAgentVersionAtom,
} from "@agenta/playground-ui/agent-version-history/store"
import {useSetAtom} from "jotai"

import {ChangeResultHostContext} from "./changeResultHost"

/**
 * The result rows of one turn's change calls (task 26.1), with the /m actions: View opens the
 * version history on the saved version; Revert opens it on the version before, whose own
 * "Revert to vN" asks first (the production revert); Try again asks the builder to read the
 * agent again. The history drawer is the one the page header mounts for its agent.
 */
export const ChangeResults = ({
    parts,
    finished,
    latest,
}: {
    parts: readonly unknown[] | undefined
    /** The turn is over. */
    finished: boolean
    /** The last turn: only its conflict offers "Try again" (a later turn may have recovered). */
    latest: boolean
}) => {
    const t = useT(chatChangeCardStatesCatalog)
    const {readOnly, send} = useContext(ChangeResultHostContext)
    // One message per click: the row stops offering it once sent.
    const [retried, setRetried] = useState(false)
    const openHistory = useSetAtom(openAgentVersionHistoryAtom)
    const selectVersion = useSetAtom(selectAgentVersionAtom)
    const actions = useMemo<ChangeResultActions>(() => {
        const showVersion = (version: ChangeVersionRef) => {
            selectVersion(version)
            openHistory(version.workflowId)
        }
        return {
            onView: showVersion,
            onRevert: readOnly ? undefined : showVersion,
            // Only once the last turn is over: while it runs, the builder may still recover.
            onTryAgain:
                latest && finished && send && !retried
                    ? () => {
                          setRetried(true)
                          // The person's own message, in the language they read the chat in.
                          send(t("chat.changeCardStates.tryAgainMessage"))
                      }
                    : undefined,
        }
    }, [readOnly, send, latest, finished, retried, openHistory, selectVersion, t])
    return <ChangeResultRows parts={parts} actions={actions} finished={finished} touch />
}
