import type {ReactNode} from "react"

import {DrawerContent, DrawerHeader, MetadataSidebar} from "@agenta/playground-ui/drawer-parts"
import {
    DrawerProvidersProvider,
    WorkflowRevisionDrawer,
    workflowRevisionDrawerContextAtom,
    workflowRevisionDrawerEntityIdAtom,
    workflowRevisionDrawerExpandedAtom,
    workflowRevisionDrawerNavigationIdsAtom,
    workflowRevisionDrawerOpenAtom,
    type DrawerContext as DrawerContextValue,
    type DrawerProviders,
} from "@agenta/playground-ui/workflow-revision-drawer"
import {Badge, Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {REVISION_ID, workflowQueries} from "./_fixtures/workflowRevision"

/**
 * The unified drawer for viewing and editing a workflow revision, plus its two parts.
 *
 * Everything the drawer shows is driven by five `atomWithReset` primitives in its own store —
 * open / entityId / context / expanded / navigationIds — all exported from
 * `@agenta/playground-ui/workflow-revision-drawer`. That makes this the cleanest atom seam in
 * the package: `parameters.agenta.atoms` writes them directly, no molecule seeding needed for
 * the shell. Only `MetadataSidebar` reaches past the store, into `workflowMolecule` — those
 * fixtures live in `_fixtures/workflowRevision.ts`.
 *
 * OSS supplies the concrete buttons through `DrawerProvidersProvider`, so the stories below
 * pass stand-ins. The real ones are OSS components the package cannot import.
 */
const meta = {
    title: "@agenta/playground-ui/Drawer/WorkflowRevision",
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component: "Drawer shell, header, content split and metadata sidebar.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/** Stand-ins for the OSS-provided renderers the drawer injects through context. */
const providers: DrawerProviders = {
    renderPlaygroundButton: () => (
        <Button size="sm" variant="outline" onClick={noop}>
            Playground
        </Button>
    ),
    renderDeployButton: () => (
        <Button size="sm" variant="outline" onClick={noop}>
            Deploy
        </Button>
    ),
    renderCommitButton: () => (
        <Button size="sm" onClick={noop}>
            Commit
        </Button>
    ),
    renderEnvironmentLabel: (envName) => <Badge variant="default">{envName}</Badge>,
    renderEvaluatorTypeLabel: () => <Badge variant="default">exact_match</Badge>,
    renderVariantDetails: ({name, version}) => (
        <span className="text-sm text-colorText">
            {name} v{version}
        </span>
    ),
    onNavigate: noop,
}

const Providers = ({children}: {children: ReactNode}) => (
    <DrawerProvidersProvider providers={providers}>{children}</DrawerProvidersProvider>
)

/** Stand-in for the OSS playground the drawer always mounts in its content area. */
const PlaygroundStandIn = () => (
    <div className="flex h-full flex-col gap-2 p-4">
        <div className="text-sm font-medium text-colorText">Playground</div>
        <div className="text-xs text-colorTextSecondary">
            OSS mounts `PlaygroundMainView` here. It is always mounted and switches between
            `configOnly` and `full` on expand — the drawer never swaps components.
        </div>
        <div className="grow rounded border border-dashed border-colorBorderSecondary" />
    </div>
)

const drawerAtoms = (
    context: DrawerContextValue,
    expanded: boolean,
    navigationIds: string[] = [],
) =>
    [
        [workflowRevisionDrawerOpenAtom, true],
        [workflowRevisionDrawerEntityIdAtom, REVISION_ID],
        [workflowRevisionDrawerContextAtom, context],
        [workflowRevisionDrawerExpandedAtom, expanded],
        [workflowRevisionDrawerNavigationIdsAtom, navigationIds],
    ] as [unknown, unknown][]

const drawerStory = (
    context: DrawerContextValue,
    expanded: boolean,
    navigationIds: string[] = [],
) => ({
    parameters: {
        agenta: {
            session: false,
            atoms: drawerAtoms(context, expanded, navigationIds),
            queries: (scope: {projectId: string}) => workflowQueries(scope.projectId),
        },
    },
    render: () => (
        <Providers>
            <WorkflowRevisionDrawer playgroundContent={<PlaygroundStandIn />} />
        </Providers>
    ),
})

/**
 * Collapsed variant context: playground on the left, metadata sidebar on the right, and the
 * Playground/Deploy actions in the header. `mask={false}` maps to a TRANSPARENT Radix overlay
 * rather than no element — Radix owns outside-click and focus trapping, so the element has to
 * stay. That mapping was added in wave 3 (`EnhancedDrawer`'s `maskClasses`).
 */
export const Collapsed: Story = drawerStory("variant", false, [REVISION_ID, "rev-other"])

/** Expanded: the sidebar collapses into the header's Info popover and the drawer widens. */
export const Expanded: Story = drawerStory("variant", true, [REVISION_ID, "rev-other"])

/** Evaluator view — title changes, header actions drop, and the mask becomes blurred. */
export const EvaluatorView: Story = drawerStory("evaluator-view", false)

/** app-create — the title is replaced by an inline editable name input, nav and actions hide. */
export const AppCreate: Story = drawerStory("app-create", true)

/** The header alone, at the four context/expand combinations that change what it renders. */
export const Header: Story = {
    parameters: {
        agenta: {
            session: false,
            atoms: drawerAtoms("variant", false, [REVISION_ID, "rev-other"]),
            queries: (scope: {projectId: string}) => workflowQueries(scope.projectId),
        },
    },
    render: () => (
        <Providers>
            <div className="flex flex-col gap-4 p-4">
                <div className="text-xs text-colorTextSecondary">
                    variant / collapsed — close, title, nav arrows, Playground + Deploy, Test App
                </div>
                <div className="rounded border border-colorBorderSecondary">
                    <DrawerHeader />
                </div>
            </div>
        </Providers>
    ),
}

/**
 * The metadata sidebar standalone: full-width on the left, the compact form the header's Info
 * popover uses on the right.
 *
 * **"Created by" is blank on purpose-by-limitation.** `UserAuthorLabel` resolves the id through
 * an atom pair the app injects at module scope (oss `AppGlobalWrappers` calls `setUserAtoms`),
 * which the harness cannot import without breaking the preview bundle — see the note in
 * `.storybook/decorators/AgentaProviders.tsx`. Not a defect in this component.
 */
export const Metadata: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: (scope: {projectId: string}) => workflowQueries(scope.projectId),
        },
    },
    render: () => (
        <Providers>
            <div className="flex gap-6 p-4">
                <div className="h-[420px] rounded border border-colorBorderSecondary">
                    <MetadataSidebar revisionId={REVISION_ID} context="variant" />
                </div>
                <div className="h-[420px] w-[260px] rounded border border-colorBorderSecondary">
                    <MetadataSidebar revisionId={REVISION_ID} context="variant" isCompact />
                </div>
            </div>
        </Providers>
    ),
}

/**
 * The content split on its own: playground area plus the sidebar, which appears only when
 * collapsed and not in a create context.
 */
export const Content: Story = {
    parameters: {
        agenta: {
            session: false,
            atoms: drawerAtoms("variant", false),
            queries: (scope: {projectId: string}) => workflowQueries(scope.projectId),
        },
    },
    render: () => (
        <Providers>
            <div className="h-[420px] rounded border border-colorBorderSecondary">
                <DrawerContent entityId={REVISION_ID} playgroundContent={<PlaygroundStandIn />} />
            </div>
        </Providers>
    ),
}
