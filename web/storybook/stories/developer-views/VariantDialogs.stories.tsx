import type {ComponentProps} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {DeleteRevisionDialog} from "../../../mobile/src/features/variants/DeleteRevisionDialog"
import {DeployRevisionDialog} from "../../../mobile/src/features/variants/DeployRevisionDialog"
import {DeployToEnvironmentDialog} from "../../../mobile/src/features/variants/DeployToEnvironmentDialog"
import {RevertDeploymentDialog} from "../../../mobile/src/features/variants/RevertDeploymentDialog"
import type {AppRevisionRow} from "../../../mobile/src/features/variants/useAppRevisions"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {workflowIds, workflowRevision, workflowVariants} from "../../fixtures/workflow"

/**
 * The deploy, delete and revert dialogs. Each reads the seeded query cache, so the environments
 * and revisions are fixtures and no request leaves the page.
 */

const noop = () => undefined

const revisionRow = (scope: StoryScope, n: number): AppRevisionRow => {
    const ids = workflowIds(scope)
    return {
        revisionId: n === 3 ? ids.revisionId : `${ids.revisionId}-${n}`,
        workflowId: ids.workflowId,
        variantId: ids.variantId,
        variantName: "Support",
        variantSlug: "invoice-helper.support",
        version: n,
        model: "gpt-4o-mini",
        message: "Lower the temperature",
        createdAt: "2026-01-04T10:00:00Z",
        createdById: null,
    }
}

const environmentsFor = (scope: StoryScope, withVariant = true) => {
    const ids = workflowIds(scope)
    const reference = (revisionId: string, version: string) => ({
        "invoice-helper.revision": {
            application: {id: ids.workflowId, slug: "invoice-helper"},
            application_variant: {id: ids.variantId, slug: "invoice-helper.support"},
            application_revision: {id: revisionId, version},
        },
    })
    const now = {created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"}
    return {
        count: 3,
        environments: [
            {
                id: "env-0",
                name: "development",
                slug: "development",
                variant_id: withVariant ? "env-variant-0" : null,
                data: {references: reference(`${ids.revisionId}-2`, "2")},
                ...now,
            },
            {
                id: "env-1",
                name: "staging",
                slug: "staging",
                variant_id: withVariant ? "env-variant-1" : null,
                ...now,
            },
            {
                id: "env-2",
                name: "production",
                slug: "production",
                variant_id: withVariant ? "env-variant-2" : null,
                ...now,
            },
        ],
    }
}

const revisionsData = (scope: StoryScope, count: number) => ({
    pages: [
        {
            rows: Array.from({length: count}, (_, i) => revisionRow(scope, count - i)),
            next: null,
        },
    ],
    pageParams: [null],
})

const seeds = (scope: StoryScope, opts: {revisions?: number; environments?: object} = {}) => {
    const ids = workflowIds(scope)
    const row = revisionRow(scope, 3)
    return [
        [["environments-list", ids.projectId, false], opts.environments ?? environmentsFor(scope)],
        [
            ["workflows", "variants", ids.workflowId, ids.projectId],
            workflowVariants(ids, ["Support"]),
        ],
        [
            ["workflows", "revision", row.revisionId, ids.projectId],
            workflowRevision(ids, {id: row.revisionId, version: 3}),
        ],
        [
            ["workflows", "app-revisions", ids.projectId, ids.workflowId, ""],
            revisionsData(scope, opts.revisions ?? 3),
        ],
    ] as [readonly unknown[], unknown][]
}

interface DemoProps {
    dialog: "deploy" | "delete" | "revert" | "deployEnvironment"
    scope?: StoryScope
}

/** Stories get their ids from the data seam, so the demo builds each dialog's props from them. */
const Demo = ({dialog, scope}: {dialog: DemoProps["dialog"]; scope?: StoryScope}) => {
    if (!scope) return null
    const ids = workflowIds(scope)
    const row = revisionRow(scope, 3)
    const common: ComponentProps<typeof DeployRevisionDialog> = {
        row,
        appId: ids.workflowId,
        appSlug: "invoice-helper",
        onClose: noop,
    }
    if (dialog === "deploy") return <DeployRevisionDialog {...common} />
    if (dialog === "delete")
        return (
            <DeleteRevisionDialog
                row={row}
                projectId={ids.projectId}
                appId={ids.workflowId}
                onClose={noop}
            />
        )
    if (dialog === "revert")
        return (
            <RevertDeploymentDialog
                row={{
                    envRevisionId: "env-rev-1",
                    environmentId: "env-0",
                    deployedRevisionId: `${ids.revisionId}-2`,
                    deployedRevisionVersion: 2,
                    variantId: ids.variantId,
                    variantSlug: "invoice-helper.support",
                    appSlug: "invoice-helper",
                    index: 2,
                    message: null,
                    createdAt: null,
                    authorId: null,
                }}
                environment={{slug: "development", name: "development"}}
                appId={ids.workflowId}
                appSlug="invoice-helper"
                onClose={noop}
            />
        )
    return (
        <DeployToEnvironmentDialog
            projectId={ids.projectId}
            appId={ids.workflowId}
            appSlug="invoice-helper"
            environment={{
                slug: "development",
                name: "development",
                deployedRevisionId: `${ids.revisionId}-2`,
                deployedLabel: "Support v2",
            }}
            onClose={noop}
        />
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Variants/VariantDialogs",
    component: Demo,
    parameters: {layout: "fullscreen"},
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

const scoped = (
    dialog: DemoProps["dialog"],
    queries: (scope: StoryScope) => [readonly unknown[], unknown][],
): Story => ({
    args: {dialog},
    parameters: {agenta: {queries, args: (scope: StoryScope) => ({scope})}},
})

const body = () => within(document.body)

/** Pick an environment: Deploy turns on. */
export const DeployPick: Story = {
    ...scoped("deploy", (scope) => seeds(scope)),
    play: async () => {
        const screen = body()
        await userEvent.click(await screen.findByRole("radio", {name: "staging"}))
        await expect(screen.getByRole("button", {name: /Deploy/})).toBeEnabled()
    },
}

/** The environments request has not settled. */
export const DeployLoadingEnvs: Story = {
    args: {dialog: "deploy"},
    parameters: {agenta: {session: false, queries: [], args: (scope: StoryScope) => ({scope})}},
}

export const DeployNoEnvs: Story = scoped("deploy", (scope) =>
    seeds(scope, {environments: {count: 0, environments: []}}),
)

/** The environment has no variant to commit to, so the deploy fails with a plain message. */
export const DeployError: Story = {
    ...scoped("deploy", (scope) => seeds(scope, {environments: environmentsFor(scope, false)})),
    play: async () => {
        const screen = body()
        await userEvent.click(await screen.findByRole("radio", {name: "staging"}))
        await userEvent.click(screen.getByRole("button", {name: /Deploy/}))
    },
}

export const DeleteOne: Story = scoped("delete", (scope) => seeds(scope))

export const DeleteOnlyRevision: Story = scoped("delete", (scope) => seeds(scope, {revisions: 1}))

export const RevertConfirm: Story = scoped("revert", (scope) => seeds(scope))

export const DeployEnvironmentPick: Story = scoped("deployEnvironment", (scope) => seeds(scope))
