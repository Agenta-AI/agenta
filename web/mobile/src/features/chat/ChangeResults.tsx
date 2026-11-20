import {useContext, useMemo} from "react"

import {ChangeResultRows, type ChangeResultActions} from "@agenta/chat/components"
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
export const ChangeResults = ({parts}: {parts: readonly unknown[] | undefined}) => {
    const t = useT(chatChangeCardStatesCatalog)
    const {readOnly, send} = useContext(ChangeResultHostContext)
    const openHistory = useSetAtom(openAgentVersionHistoryAtom)
    const selectVersion = useSetAtom(selectAgentVersionAtom)
    const actions = useMemo<ChangeResultActions>(() => {
        const showVersion = (workflowId: string, revisionId: string) => {
            selectVersion({workflowId, revisionId})
            openHistory(workflowId)
        }
        return {
            onView: (call) => {
                if (call.state.kind !== "saved") return
                const {agentId, revisionId} = call.state
                if (agentId && revisionId) showVersion(agentId, revisionId)
            },
            onRevert: readOnly
                ? undefined
                : (call) => {
                      if (call.state.kind !== "saved") return
                      const {agentId} = call.state
                      if (agentId && call.baseRevisionId) showVersion(agentId, call.baseRevisionId)
                  },
            onTryAgain:
                readOnly || !send
                    ? undefined
                    : // The person's own message, in the language they read the chat in.
                      () => send(t("chat.changeCardStates.tryAgainMessage")),
        }
    }, [readOnly, send, openHistory, selectVersion, t])
    return <ChangeResultRows parts={parts} actions={actions} touch />
}
