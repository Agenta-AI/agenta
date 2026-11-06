import {useMemo, type ComponentType} from "react"

import {latestRevisionForTestsetAtomFamily, testsetQueryAtomFamily} from "@agenta/entities/testset"
import {workflowDetailQueryAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {traceDrawerProjectURLAtom} from "@agenta/observability/traceDrawer"
import {useAtomValue} from "jotai"

import type {ReferenceLabelProps} from "../traceDrawer/referenceSlots"

import {ReferenceChip, ReferenceChipSkeleton} from "./ReferenceChip"

/** Where each kind of reference links to. Each app passes its own routes. */
export interface ReferenceHrefs {
    app: (base: string, args: {appId: string}) => string
    variant: (base: string, args: {appId: string; revisionId: string}) => string
    environment: (base: string, args: {appId: string; slug: string}) => string
    testset: (base: string, args: {testsetId: string; revisionId: string | null}) => string
}

type Props = ReferenceLabelProps & Record<string, unknown>

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null)

const Placeholder = () => <span className="text-colorTextSecondary">—</span>

/** An app or an evaluator: both are workflows, read by id. */
const useWorkflow = (id: string | null) => {
    const query = useAtomValue(useMemo(() => workflowDetailQueryAtomFamily(id), [id]))
    return query
}

/**
 * The trace drawer's reference slots, as named, linked chips. `hrefs` builds the links in the
 * host's own routes; an evaluator link comes from the drawer.
 */
export const createReferenceLabels = (routes: ReferenceHrefs) => {
    // No project URL yet (or none bound by the host): chips render without links.
    const useHref = <K extends keyof ReferenceHrefs>(
        kind: K,
        args: Parameters<ReferenceHrefs[K]>[1] | null,
    ): string | null => {
        const base = useAtomValue(traceDrawerProjectURLAtom)
        if (!base || !args) return null
        return (routes[kind] as (base: string, args: Parameters<ReferenceHrefs[K]>[1]) => string)(
            base,
            args,
        )
    }

    const ApplicationReferenceLabel = (props: Props) => {
        const appId = str(props.applicationId)
        const query = useWorkflow(appId)
        const href = useHref("app", appId ? {appId} : null)
        const fallback = str(props.label)
        if (!appId)
            return fallback ? <ReferenceChip kind="app" label={fallback} /> : <Placeholder />
        if (query.isPending) return <ReferenceChipSkeleton />
        const app = query.data
        // Only a lookup that worked and found nothing means deleted; a failed lookup keeps the slug.
        const deleted = !query.isError && !app
        return (
            <ReferenceChip
                kind="app"
                label={deleted ? "Deleted" : (app?.name ?? app?.slug ?? fallback ?? appId)}
                href={href}
                openExternally={props.openExternally === true}
                identifiers={{slug: app?.slug ?? fallback, id: appId}}
                deleted={deleted}
            />
        )
    }

    const VariantReferenceLabel = (props: Props) => {
        const revisionId = str(props.revisionId)
        const data = useAtomValue(
            useMemo(() => workflowMolecule.selectors.data(revisionId ?? ""), [revisionId]),
        )
        const query = useAtomValue(
            useMemo(() => workflowMolecule.selectors.query(revisionId ?? ""), [revisionId]),
        )
        const fallback = str(props.fallbackLabel) ?? str(props.label)
        const appId = data?.workflow_id ?? null
        const href = useHref("variant", appId && revisionId ? {appId, revisionId} : null)
        if (!revisionId) {
            return fallback ? <ReferenceChip kind="variant" label={fallback} /> : <Placeholder />
        }
        if (query.isPending) return <ReferenceChipSkeleton />
        const resolved = Boolean(data?.name || data?.slug || data?.version != null)
        const deleted = !resolved && !fallback
        return (
            <ReferenceChip
                kind="variant"
                label={deleted ? "Deleted" : (data?.name ?? data?.slug ?? fallback ?? revisionId)}
                href={href}
                openExternally={props.openExternally === true}
                identifiers={{
                    slug: data?.slug ?? null,
                    id: data?.workflow_variant_id ?? null,
                    version: data?.version ?? null,
                    revisionId,
                }}
                deleted={deleted}
            />
        )
    }

    const EnvironmentReferenceLabel = (props: Props) => {
        const slug = str(props.environmentSlug) ?? str(props.label)
        const appId = str(props.applicationId)
        const href = useHref("environment", appId && slug ? {appId, slug} : null)
        if (!slug) return <Placeholder />
        return (
            <ReferenceChip
                kind="environment"
                label={slug}
                href={href}
                openExternally={props.openExternally === true}
                identifiers={{id: str(props.environmentId)}}
            />
        )
    }

    const EvaluatorReferenceLabel = (props: Props) => {
        const evaluatorId = str(props.evaluatorId)
        const query = useWorkflow(evaluatorId)
        const fallback = str(props.evaluatorSlug) ?? str(props.label)
        if (!evaluatorId) {
            return fallback ? <ReferenceChip kind="evaluator" label={fallback} /> : <Placeholder />
        }
        if (query.isPending) return <ReferenceChipSkeleton />
        const evaluator = query.data
        const deleted = !query.isError && !evaluator && !fallback
        return (
            <ReferenceChip
                kind="evaluator"
                label={
                    deleted
                        ? "Deleted"
                        : (evaluator?.name ?? evaluator?.slug ?? fallback ?? evaluatorId)
                }
                href={str(props.href)}
                openExternally={props.openExternally === true}
                identifiers={{slug: evaluator?.slug ?? fallback, id: evaluatorId}}
                deleted={deleted}
            />
        )
    }

    const TestsetTag = (props: Props) => {
        const testsetId = str(props.testsetId)
        const query = useAtomValue(
            useMemo(() => testsetQueryAtomFamily(testsetId ?? ""), [testsetId]),
        )
        const latest = useAtomValue(
            useMemo(() => latestRevisionForTestsetAtomFamily(testsetId ?? ""), [testsetId]),
        )
        const revisionId = str(props.revisionId) ?? latest?.id ?? null
        const href = useHref("testset", testsetId ? {testsetId, revisionId} : null)
        if (!testsetId) return <Placeholder />
        if (query.isPending) return <ReferenceChipSkeleton />
        const testset = query.data
        const deleted = !query.isError && !testset?.name
        return (
            <ReferenceChip
                kind="testset"
                label={deleted ? "Deleted" : (testset?.name ?? testsetId)}
                href={deleted ? null : href}
                openExternally={props.openExternally === true}
                identifiers={{id: testsetId, revisionId: str(props.revisionId)}}
                deleted={deleted}
            />
        )
    }

    return {
        ApplicationReferenceLabel,
        VariantReferenceLabel,
        EnvironmentReferenceLabel,
        EvaluatorReferenceLabel,
        TestsetTag,
    } satisfies Record<string, ComponentType<Props>>
}
