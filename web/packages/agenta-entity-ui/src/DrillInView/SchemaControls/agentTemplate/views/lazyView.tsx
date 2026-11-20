import {lazy, Suspense, useContext, useMemo, type ComponentType, type ReactNode} from "react"

import type {ViewProps} from "@agenta/ui/view-stack"

import {AgentEditorContext} from "../useAgentConfigWriter"

/**
 * Wraps every view body. When the host shows the view read only (a phone container and
 * `readOnlyOnPhone`), the body reads the agent through a read-only editor, so it shows its content
 * with no edit control and no Save; otherwise it passes the outer editor through unchanged.
 */
const ReadOnlyEditor = ({readOnly, children}: {readOnly: boolean; children: ReactNode}) => {
    const editor = useContext(AgentEditorContext)
    const value = useMemo(
        () => (editor && readOnly ? {...editor, readOnly: true} : editor),
        [editor, readOnly],
    )
    return <AgentEditorContext.Provider value={value}>{children}</AgentEditorContext.Provider>
}

/** A view body that loads on first open, with a fallback in its own place while it loads. */
export const lazyView = <P,>(
    load: () => Promise<{default: ComponentType<ViewProps<P>>}>,
    fallback: ReactNode = null,
): ComponentType<ViewProps<P>> => {
    const Body = lazy(load)
    const LazyView = (props: ViewProps<P>) => {
        // One root in both modes, so a resize across the phone width keeps the body's draft.
        return (
            <ReadOnlyEditor readOnly={Boolean(props.readOnly)}>
                <Suspense fallback={fallback}>
                    <Body {...props} />
                </Suspense>
            </ReadOnlyEditor>
        )
    }
    return LazyView
}
