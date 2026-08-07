import type {ReactNode} from "react"

import {
    evaluatorAdapter,
    registerSelectionAdapter,
    setEvaluatorAtoms,
    workflowRevisionAdapter,
} from "@agenta/entity-ui/selection"
import {entitySelectorConfigAtom, entitySelectorOpenAtom} from "@agenta/playground/state"
import {
    EntitySelector,
    EntitySelectorModal,
    type EntityType,
} from "@agenta/playground-ui/entity-selector"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {atom} from "jotai"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {entityPickerQueries} from "../../fixtures/entityPicker"

// `EntitySelector` resolves both pickers by NAME (`adapter="workflowRevision"` /
// `adapter="evaluator"`), and `resolveAdapter` THROWS on an unregistered name. In the app the
// registration happens in `initializeSelectionSystem()`, which Storybook never calls — the
// tab therefore crashed with `[EntitySelection] Adapter not found: workflowRevision`.
//
// Registering directly rather than through `initializeSelectionSystem` on purpose: that
// function is a one-shot singleton (`if (initialized) return`), so whichever story ran first
// would decide whether the evaluator adapter exists for every story after it.
registerSelectionAdapter(workflowRevisionAdapter)
setEvaluatorAtoms({
    evaluatorsAtom: atom(() => [
        {id: "eval-exact-match", name: "Exact match"},
        {id: "eval-llm-judge", name: "LLM judge"},
        {id: "eval-json-valid", name: "Valid JSON"},
    ]),
})
registerSelectionAdapter(evaluatorAdapter)

/**
 * The entity picker used to attach a workflow revision, an evaluator, a testcase or a span to
 * the playground. Four antd swaps live here: `Tabs`, `Input`, `Button` and the
 * `Space.Compact` join between the last two (now a plain flex row with the inner corners
 * flattened by `rounded-r-none` / `rounded-l-none`).
 *
 * Showcases, not parity rows — each swapped primitive is already pixel-gated by its own
 * `--antd-vs-agenta` story, and the `Space.Compact` join has no antd half left to compare
 * against.
 *
 * ## Which export needs what
 *
 * - **`EntitySelector`** is the standalone body and is fully prop-driven: it renders
 *   `EntitySelectorContent` straight from its `config` prop. No provider, no atoms.
 * - **`EntitySelectorModal`** reads `entitySelectorController.selectors.isOpen/config`, which
 *   are the plain primitives `entitySelectorOpenAtom` / `entitySelectorConfigAtom` exported
 *   from `@agenta/playground/state` — so `parameters.agenta.atoms` opens it directly. It does
 *   **not** need `EntitySelectorProvider`; the provider only exists to wrap the modal in the
 *   promise-based `useEntitySelector().open()` API, which a static story cannot exercise.
 * - **`EntitySelectorProvider` / `useEntitySelector`** are therefore not storied: the provider
 *   renders the same modal (closed until an imperative `open()` call) and the hook is a plain
 *   context read.
 *
 * ## The two data-backed tabs
 *
 * `Workflow Revision` and `Evaluator` delegate to `EntityPicker` from `@agenta/entity-ui`,
 * which fetches. Stories below close the session gate (`session: false`) so nothing reaches the
 * network — the pickers then render their own empty/loading branch, which is the honest
 * unseeded state. The testcase and span tabs are self-contained and render fully.
 */
const meta = {
    title: "@agenta/playground-ui/EntitySelector",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component: "Tabbed picker for workflow revisions, evaluators, testcases, spans.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Case = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex flex-col gap-1 border-b border-colorBorderSecondary py-4">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[520px]">{children}</div>
    </div>
)

/** Closed gate — the two picker tabs never fetch; the two ID tabs are self-contained. */
const noNetwork = {agenta: {session: false, queries: []}}

/**
 * The default `allowedTypes` (`workflow`, `testcase`, `span`) plus the implicit `evaluator`
 * tab that `entityTypesToTabs` injects alongside `workflow` — four triggers.
 *
 * The active `Workflow Revision` tab is seeded from the shared EntityPicker fixtures
 * (`fixtures/entityPicker.ts`), so its `Workflow` select has a real hierarchy behind it. The
 * three selects still read "Select workflow… / Select workflow first / Select variant first"
 * in a static shot — that IS the cascading variant's initial state; the seeded rows only
 * appear once the first dropdown is opened.
 */
export const AllTabs: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: (scope: StoryScope) => entityPickerQueries(scope),
        },
    },
    render: () => (
        <div className="w-[560px]">
            <EntitySelector onSelect={noop} />
        </div>
    ),
}

/**
 * The `Evaluator` tab — a flat list rather than the cascading selects, fed by the story-local
 * `evaluatorsAtom` registered at the top of this file.
 *
 * **Typing gap worth flagging:** the evaluator tab is UI-only. `entityTypesToTabs` synthesises
 * it next to `workflow`, but `EntitySelectorConfig.defaultType` is typed `EntityType`
 * (`workflow | testcase | span`), so there is no typed way to open the selector ON the
 * evaluator tab even though `activeTab` is a `SelectorTab` and accepts it at runtime. Hence
 * the cast: the component supports this, its config type does not.
 */
export const EvaluatorTab: Story = {
    parameters: noNetwork,
    render: () => (
        <div className="w-[560px]">
            <EntitySelector
                onSelect={noop}
                config={{
                    allowedTypes: ["workflow", "testcase"],
                    defaultType: "evaluator" as EntityType,
                }}
            />
        </div>
    ),
}

/**
 * A single allowed type skips the `Tabs` entirely (`if (allowedTypes.length === 1)`), so the
 * body renders bare. These are the two tabs with no data dependency, which makes them the
 * clearest look at the `Input` + `Button` compact join.
 */
export const SingleType: Story = {
    parameters: noNetwork,
    render: () => (
        <div className="flex flex-col">
            <Case label="testcase only — no tab strip, ID input + Select">
                <EntitySelector onSelect={noop} config={{allowedTypes: ["testcase"]}} />
            </Case>
            <Case label="span only — same shape, no 'coming soon' hint">
                <EntitySelector onSelect={noop} config={{allowedTypes: ["span"]}} />
            </Case>
        </div>
    ),
}

/** `defaultType` picks the initially active tab rather than the first in the list. */
export const DefaultTabSpan: Story = {
    parameters: noNetwork,
    render: () => (
        <div className="w-[560px]">
            <EntitySelector
                onSelect={noop}
                config={{allowedTypes: ["testcase", "span"], defaultType: "span"}}
            />
        </div>
    ),
}

/**
 * The modal wrapper, opened by seeding its two primitives. **The body is a portal** —
 * `EnhancedModal` renders outside `#storybook-root`, so a check that reads only the story
 * container sees an empty page while the modal is fine.
 */
export const Modal: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: [],
            atoms: [
                [entitySelectorOpenAtom, true],
                [
                    entitySelectorConfigAtom,
                    {title: "Connect input", allowedTypes: ["testcase", "span"]},
                ],
            ],
        },
    },
    render: () => (
        <div className="p-4">
            <div className="text-xs text-colorTextSecondary">
                The modal below renders into a portal, outside this container.
            </div>
            <EntitySelectorModal onSelection={noop} />
        </div>
    ),
}

/**
 * `open` seeded false. Renders nothing at all — `EnhancedModal` unmounts its children, which
 * is what keeps the pickers' queries from subscribing before the user opens the dialog. An
 * empty page is the correct result.
 */
export const ModalClosed: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: [],
            atoms: [
                [entitySelectorOpenAtom, false],
                [entitySelectorConfigAtom, {}],
            ],
        },
    },
    render: () => (
        <div className="p-4">
            <div className="text-xs text-colorTextSecondary">
                Modal closed. Nothing below this line is expected to render.
            </div>
            <EntitySelectorModal onSelection={noop} />
        </div>
    ),
}
