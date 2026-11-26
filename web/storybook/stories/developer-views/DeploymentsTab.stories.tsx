import type {AppDeploymentRow, AppEnvironmentDeployment} from "@agenta/entities/environment"
import {LoadError} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {DeploymentHistoryTable} from "../../../mobile/src/features/variants/DeploymentHistoryTable"
import {EnvironmentCards} from "../../../mobile/src/features/variants/EnvironmentCards"
import {DeploymentsEmpty} from "../../../mobile/src/features/variants/states/DeploymentsEmpty"
import {EnvironmentCardsSkeleton} from "../../../mobile/src/features/variants/states/EnvironmentCardsSkeleton"

/** The Deployments tab: environment cards over the history of the chosen environment. */

const env = (name: string, revisionId: string | null): AppEnvironmentDeployment => ({
    name,
    slug: name,
    deployedVariantId: revisionId ? "v-support" : null,
    deployedRevisionId: revisionId,
    deployedVariantName: revisionId ? "Support" : null,
    revision: revisionId ? "3" : null,
    updatedAt: revisionId ? "2026-01-04T10:00:00Z" : null,
})

const ENVIRONMENTS = [env("development", "rev-3"), env("staging", "rev-2"), env("production", null)]

const historyRow = (index: number, revisionId: string): AppDeploymentRow => ({
    envRevisionId: `env-rev-${index}`,
    environmentId: "env-1",
    deployedRevisionId: revisionId,
    deployedRevisionVersion: index,
    variantId: "v-support",
    variantSlug: "invoice-helper.support",
    appSlug: "invoice-helper",
    index,
    message: index === 3 ? "Ship the lower temperature" : null,
    createdAt: `2026-01-0${index}T10:00:00Z`,
    authorId: null,
})

const HISTORY = [historyRow(3, "rev-3"), historyRow(2, "rev-2"), historyRow(1, "rev-1")]

interface DemoProps {
    state: "loading" | "filled" | "noHistory" | "failed"
    canRevert?: boolean
}

const Demo = ({state, canRevert = true}: DemoProps) => (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 text-foreground">
        {state === "loading" ? (
            <EnvironmentCardsSkeleton />
        ) : state === "failed" ? (
            <LoadError framed title="Could not load deployments" onRetry={() => undefined} />
        ) : (
            <>
                <EnvironmentCards
                    environments={ENVIRONMENTS}
                    selectedSlug={state === "noHistory" ? "production" : "development"}
                    onSelect={() => undefined}
                />
                <DeploymentHistoryTable
                    rows={state === "noHistory" ? [] : HISTORY}
                    isLoading={false}
                    variantNames={new Map([["v-support", "Support"]])}
                    authorNames={new Map()}
                    currentRevisionId="rev-3"
                    canRevert={canRevert}
                    onOpen={() => undefined}
                    onRevert={() => undefined}
                    empty={<DeploymentsEmpty />}
                />
            </>
        )}
    </div>
)

const meta = {
    title: "@agenta/mobile/Developer/Variants/DeploymentsTab",
    component: Demo,
    parameters: {layout: "fullscreen"},
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {args: {state: "loading"}}
/** Development is selected; the production card shows "No deployment". */
export const Filled: Story = {args: {state: "filled"}}
export const NoHistory: Story = {args: {state: "noHistory"}}
export const ReadOnly: Story = {args: {state: "filled", canRevert: false}}
export const LoadFailed: Story = {args: {state: "failed"}}
export const Phone: Story = {
    args: {state: "filled"},
    globals: {viewport: {value: "mobile1", isRotated: false}},
}
