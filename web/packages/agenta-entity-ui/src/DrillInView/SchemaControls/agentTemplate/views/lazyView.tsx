import {lazy, Suspense, useContext, useMemo, type ComponentType, type ReactNode} from "react"

import type {ViewProps} from "@agenta/ui/view-stack"

import {AgentEditorContext} from "../useAgentConfigWriter"

/**
 * A view the host shows read only (a phone container and `readOnlyOnPhone`): its body reads the
 * agent through a read-only editor, so it shows its content with no edit control and no Save.
 */
const ReadOnlyEditor = ({children}: {children: ReactNode}) => {
    const editor = useContext(AgentEditorContext)
    const readOnlyEditor = useMemo(() => (editor ? {...editor, readOnly: true} : null), [editor])
    return (
        <AgentEditorContext.Provider value={readOnlyEditor}>{children}</AgentEditorContext.Provider>
    )
}

/** A view body that loads on first open, with a fallback in its own place while it loads. */
export const lazyView = <P,>(
    load: () => Promise<{default: ComponentType<ViewProps<P>>}>,
    fallback: ReactNode = null,
): ComponentType<ViewProps<P>> => {
    const Body = lazy(load)
    const LazyView = (props: ViewProps<P>) => {
        const body = (
            <Suspense fallback={fallback}>
                <Body {...props} />
            </Suspense>
        )
        return props.readOnly ? <ReadOnlyEditor>{body}</ReadOnlyEditor> : body
    }
    return LazyView
}
