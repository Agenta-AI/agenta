import type {ReactNode} from "react"

/** Which list opened the drawer. It sets the title, the Test label and the detail rows. */
export type EditableRevisionDrawerKind = "variant" | "deployment" | "evaluator"

export interface EditableRevisionDrawerProps {
    /**
     * The revision to show and edit: a saved revision id, or an unsaved local one (`local-*`),
     * for example a new evaluator made from a template. null = closed.
     */
    revisionId: string | null
    kind: EditableRevisionDrawerKind
    /** The drawer asked to close, after the reader confirmed any unsaved edits are lost. */
    onClose: () => void
    /** Ids for previous and next, in list order. The arrows show only with 2 or more. */
    navigationIds?: readonly string[]
    /** Show another revision. Called after the reader confirmed any unsaved edits are lost. */
    onNavigate?: (revisionId: string) => void
    /** Header buttons, right of the title (Open in playground, Deploy, Revert). The host owns them. */
    actions?: ReactNode
    /** Buttons on the config bar, before Commit (for example Load preset). */
    configActions?: ReactNode
    /**
     * The test pane for the shown revision (test cases and runs, or the chat). Drawn only while
     * Test is on. The drawer has already put the revision in the playground state.
     */
    renderRuns: (revisionId: string) => ReactNode
    /** Without edit permission the config is read only and Commit is disabled. Default true. */
    canCommit?: boolean
    /** "Commit and deploy" offers the app's environments. Default false. */
    canDeploy?: boolean
    /**
     * A Commit made a new revision (or Create saved a local one). The host shows it, usually by
     * calling its own `onNavigate`; the drawer follows the new id in the playground state.
     */
    onCommitted?: (fromRevisionId: string, newRevisionId: string) => void
    /** Shows the wand on each prompt section. */
    onRefinePrompt?: (revisionId: string, promptKey: string) => void
    /** Open with the test pane on. Default false. */
    defaultTesting?: boolean
    /**
     * False: no test pane, and the drawer leaves the playground state alone, so it can open over a
     * page that shows a playground (create an evaluator from the app playground). A local draft
     * it shows is discarded on close. Default true.
     */
    playground?: boolean
}
