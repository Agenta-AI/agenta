import {useState} from "react"

import {RevisionDrawer, type RevisionDrawerKind} from "@agenta/entity-ui/variant"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, waitFor, within} from "storybook/test"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {
    variantNameCellQueries,
    workflowIds,
    workflowRevision,
    type WorkflowIds,
} from "../../fixtures/workflow"

/**
 * The read-only revision drawer that the /m variants, deployments and evaluators views open.
 * Data-connected: the revision, its variant and its environments come from the seeded query
 * cache. The host owns open state, so this story keeps the revision id in local state.
 */

const PROMPT_PARAMETERS = {
    prompt: {
        messages: [
            {role: "system", content: "You answer questions about the user's invoices."},
            {role: "user", content: "{{question}}"},
        ],
        llm_config: {model: "gpt-4o-mini", temperature: 0.2},
    },
}

const variantRevision = (ids: WorkflowIds, id = ids.revisionId, version = 3) =>
    workflowRevision(ids, {
        id,
        version,
        slug: `invoice-helper-v${version}`,
        flags: {is_application: true, is_chat: true},
        message: "Lower the temperature",
        created_by_id: "user-1",
        data: {uri: "agenta:builtin:chat:v0", parameters: PROMPT_PARAMETERS},
    })

const evaluatorRevision = (ids: WorkflowIds) =>
    workflowRevision(ids, {
        slug: "exact-match-v2",
        version: 2,
        message: null,
        flags: {is_evaluator: true},
        data: {
            uri: "agenta:builtin:auto_exact_match:v0",
            parameters: {correct_answer_key: "expected_output"},
        },
    })

/** Three revisions of one variant, so prev and next have somewhere to go. */
const variantQueries = (scope: StoryScope, deployedTo: string[] = []) => {
    const ids = workflowIds(scope)
    const second = `${ids.revisionId}-2`
    const third = `${ids.revisionId}-3`
    return [
        ...variantNameCellQueries(scope, {
            revision: (i) => variantRevision(i),
            variantNames: ["default"],
            deployedTo,
        }),
        [["workflows", "revision", second, ids.projectId], variantRevision(ids, second, 2)],
        [["workflows", "revision", third, ids.projectId], variantRevision(ids, third, 1)],
    ] as [readonly unknown[], unknown][]
}

const navigation = (scope: StoryScope) => {
    const {revisionId} = workflowIds(scope)
    return [revisionId, `${revisionId}-2`, `${revisionId}-3`]
}

interface DemoProps {
    revisionId: string
    kind: RevisionDrawerKind
    navigationIds?: string[]
    withActions?: boolean
}

const Demo = ({revisionId, kind, navigationIds, withActions}: DemoProps) => {
    const [openId, setOpenId] = useState<string | null>(revisionId)
    return (
        <>
            <Button onClick={() => setOpenId(revisionId)}>Open revision</Button>
            <RevisionDrawer
                revisionId={openId}
                kind={kind}
                onClose={() => setOpenId(null)}
                navigationIds={navigationIds}
                onNavigate={setOpenId}
                actions={withActions ? <Button size="sm">Deploy</Button> : undefined}
            />
        </>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Revisions/RevisionDrawer",
    component: Demo,
    parameters: {layout: "fullscreen"},
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

/** A variant revision with prev and next and a host "Deploy" action. Play: next, YAML, Escape. */
export const Variant: Story = {
    args: {revisionId: "", kind: "variant", withActions: true},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => variantQueries(scope),
            args: (scope: StoryScope) => ({
                revisionId: workflowIds(scope).revisionId,
                navigationIds: navigation(scope),
            }),
        },
    },
    play: async () => {
        const screen = body()
        await screen.findByRole("heading", {name: "Revision"})
        await userEvent.click(await screen.findByRole("button", {name: "Next revision"}))
        await waitFor(() =>
            expect(screen.getByRole("button", {name: "Previous revision"})).toBeEnabled(),
        )
        await userEvent.click(await screen.findByRole("radio", {name: "YAML"}))
        await waitFor(() =>
            expect(screen.getByRole("radio", {name: "YAML"})).toHaveAttribute(
                "aria-checked",
                "true",
            ),
        )
        await userEvent.keyboard("{Escape}")
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    },
}

/** A deployed revision: the config starts in JSON, and the variant and environments show. */
export const Deployment: Story = {
    args: {revisionId: "", kind: "deployment", withActions: true},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => variantQueries(scope, ["production", "staging"]),
            args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
        },
    },
}

/** A builtin evaluator: the type comes from the evaluator catalog, the slug from the workflow. */
export const Evaluator: Story = {
    args: {revisionId: "", kind: "evaluator"},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => {
                const ids = workflowIds(scope)
                const revision = evaluatorRevision(ids)
                return [
                    [["workflows", "revision", ids.revisionId, ids.projectId], revision],
                    [
                        ["workflows", "artifact", ids.workflowId, ids.projectId],
                        workflowRevision(ids, {id: ids.workflowId, slug: "exact-match"}),
                    ],
                    [
                        ["evaluatorTemplates", ids.projectId],
                        {
                            count: 1,
                            templates: [{key: "auto_exact_match", name: "Exact Match"}],
                        },
                    ],
                    [["environments-list", ids.projectId, false], {count: 0, environments: []}],
                ]
            },
            args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
        },
    },
}

/** The revision query has not settled: the skeleton keeps the final layout. */
export const Loading: Story = {
    args: {revisionId: "", kind: "variant"},
    parameters: {
        agenta: {
            // No session: every query stays disabled, so the revision never settles.
            session: false,
            queries: [],
            args: (scope: StoryScope) => ({
                revisionId: workflowIds(scope).revisionId,
                navigationIds: navigation(scope),
            }),
        },
    },
}

/** The revision settled empty (a deleted id or another project's id). */
export const NotFound: Story = {
    args: {revisionId: "", kind: "variant"},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => {
                const ids = workflowIds(scope)
                return [[["workflows", "revision", ids.revisionId, ids.projectId], null]]
            },
            args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
        },
    },
}

/** The revision request failed: no fixture, so the story's fetch fails and offers a retry. */
export const LoadError: Story = {
    args: {revisionId: "", kind: "variant"},
    parameters: {
        agenta: {
            queries: [],
            args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
        },
    },
}

/** The phone layout: full screen, details below the configuration. */
export const Phone: Story = {
    ...Variant,
    play: undefined,
    globals: {viewport: {value: "mobile1", isRotated: false}},
}
