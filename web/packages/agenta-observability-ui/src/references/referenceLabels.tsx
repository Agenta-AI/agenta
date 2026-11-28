import {useEffect, useMemo, type ComponentType} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {testsetMolecule, testsetQueryAtomFamily} from "@agenta/entities/testset"
import {workflowDetailQueryAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import referencesCatalog from "@agenta/i18n/catalogs/observabilityUi.references"
import {traceDrawerProjectURLAtom} from "@agenta/observability/traceDrawer"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue, useSetAtom} from "jotai"

import type {ReferenceLabelProps} from "../traceDrawer/referenceSlots"

import {testcaseChipLabel} from "./mergeReferenceChips"
import {ReferenceChip, ReferenceChipSkeleton} from "./ReferenceChip"

/** Where each kind of reference links to. Each app passes its own routes. */
export interface ReferenceHrefs {
    app: (base: string, args: {appId: string}) => string
    variant: (base: string, args: {appId: string; revisionId: string}) => string
    environment: (base: string, args: {appId: string; slug: string}) => string
    /** With `testcaseId`, the link opens that test case (the host adds its query parameter). */
    testset: (
        base: string,
        args: {testsetId: string; revisionId: string | null; testcaseId: string | null},
    ) => string
}

type Props = ReferenceLabelProps & Record<string, unknown>

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null)

const Placeholder = () => <span className="text-muted-foreground">—</span>

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

    /** An application revision, read by id: its data (version, workflow id) and load state. */
    const useRevision = (revisionId: string | null) => {
        const data = useAtomValue(
            useMemo(() => workflowMolecule.selectors.data(revisionId ?? ""), [revisionId]),
        )
        const query = useAtomValue(
            useMemo(() => workflowMolecule.selectors.query(revisionId ?? ""), [revisionId]),
        )
        return {data: revisionId ? data : null, isPending: Boolean(revisionId) && query.isPending}
    }

    /**
     * An application. With `revisionId` the chip also names the variant and its version, as
     * "lead_scorer / with_site_text" v8. `href` replaces the link the routes build.
     */
    const ApplicationReferenceLabel = (props: Props) => {
        const t = useT(referencesCatalog)
        const appId = str(props.applicationId)
        const revisionId = str(props.revisionId)
        const query = useWorkflow(appId)
        const revision = useRevision(revisionId)
        // The variant's own name (never the revision's fields, web/AGENTS.md "Entity display names").
        const variantName = useAtomValue(
            useMemo(() => workflowMolecule.selectors.variantLabel(revisionId ?? ""), [revisionId]),
        )
        const routeHref = useHref("app", appId ? {appId} : null)
        const href = str(props.href) ?? routeHref
        const fallback = str(props.label)
        if (!appId)
            return fallback ? <ReferenceChip kind="app" label={fallback} /> : <Placeholder />
        if (query.isPending || revision.isPending) return <ReferenceChipSkeleton />
        const app = query.data
        // Only a lookup that worked and found nothing means deleted; a failed lookup keeps the slug.
        const deleted = !query.isError && !app
        const appName = app?.name ?? app?.slug ?? fallback ?? appId
        return (
            <ReferenceChip
                kind="app"
                label={
                    deleted
                        ? t("observabilityUi.references.deleted")
                        : variantName
                          ? `${appName} / ${variantName}`
                          : appName
                }
                href={href}
                openExternally={props.openExternally === true}
                identifiers={{
                    slug: app?.slug ?? fallback,
                    id: appId,
                    version: revision.data?.version ?? null,
                    revisionId,
                }}
                deleted={deleted}
            />
        )
    }

    const VariantReferenceLabel = (props: Props) => {
        const t = useT(referencesCatalog)
        const revisionId = str(props.revisionId)
        const {data, isPending} = useRevision(revisionId)
        const fallback = str(props.fallbackLabel) ?? str(props.label)
        const appId = data?.workflow_id ?? null
        const href = useHref("variant", appId && revisionId ? {appId, revisionId} : null)
        if (!revisionId) {
            return fallback ? <ReferenceChip kind="variant" label={fallback} /> : <Placeholder />
        }
        if (isPending) return <ReferenceChipSkeleton />
        const resolved = Boolean(data?.name || data?.slug || data?.version != null)
        const deleted = !resolved && !fallback
        return (
            <ReferenceChip
                kind="variant"
                label={
                    deleted
                        ? t("observabilityUi.references.deleted")
                        : (data?.name ?? data?.slug ?? fallback ?? revisionId)
                }
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
        const routeHref = useHref("environment", appId && slug ? {appId, slug} : null)
        const href = str(props.href) ?? routeHref
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
        const t = useT(referencesCatalog)
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
                        ? t("observabilityUi.references.deleted")
                        : (evaluator?.name ?? evaluator?.slug ?? fallback ?? evaluatorId)
                }
                href={str(props.href)}
                openExternally={props.openExternally === true}
                identifiers={{slug: evaluator?.slug ?? fallback, id: evaluatorId}}
                deleted={deleted}
            />
        )
    }

    /**
     * The revision a test set link opens: the given one, else the test set's latest saved revision
     * (as the test set list opens it). Pending until the latest revision has loaded.
     */
    const useLinkedRevision = (testsetId: string | null, given: string | null) => {
        const projectId = useAtomValue(projectIdAtom)
        const lookup = testsetId && !given && projectId ? testsetId : ""
        const request = useSetAtom(testsetMolecule.latestRevision.request)
        useEffect(() => {
            if (lookup && projectId) request({testsetId: lookup, projectId})
        }, [lookup, projectId, request])
        const latest = useAtomValue(
            useMemo(() => testsetMolecule.latestRevision.selectors.stateful(lookup), [lookup]),
        )
        if (given) return {revisionId: given, pending: false}
        if (!lookup) return {revisionId: null, pending: false}
        // Version 0 is the empty placeholder every test set starts with: no page to open.
        const saved = latest.data && latest.data.version > 0 ? latest.data.id : null
        return {revisionId: saved, pending: latest.isPending}
    }

    /**
     * A test set, or with `testcaseId` one test case of it: "support-faq / 7f3a1c". A test case
     * with no `testsetId` (a trace names only the test case) loads the test case for its test set.
     * The link opens a revision of the test set (the given one, else the latest), with the test
     * case open; with no revision there is no link.
     */
    const TestsetTag = (props: Props) => {
        const t = useT(referencesCatalog)
        const testcaseId = str(props.testcaseId)
        const lookupId = !str(props.testsetId) && testcaseId ? testcaseId : ""
        const testcase = useAtomValue(useMemo(() => testcaseMolecule.query(lookupId), [lookupId]))
        const testsetId =
            str(props.testsetId) ?? str(testcase.data?.testset_id) ?? str(testcase.data?.set_id)
        const query = useAtomValue(
            useMemo(() => testsetQueryAtomFamily(testsetId ?? ""), [testsetId]),
        )
        const linked = useLinkedRevision(testsetId, str(props.revisionId))
        const revisionId = linked.revisionId
        const routeHref = useHref(
            "testset",
            testsetId && revisionId ? {testsetId, revisionId, testcaseId} : null,
        )
        const href = str(props.href) ?? routeHref
        if (!testsetId) {
            return lookupId && testcase.isPending ? <ReferenceChipSkeleton /> : <Placeholder />
        }
        if (query.isPending || linked.pending) return <ReferenceChipSkeleton />
        const testset = query.data
        const deleted = !query.isError && !testset?.name
        const name = testset?.name ?? testsetId
        return (
            <ReferenceChip
                kind={testcaseId ? "testcase" : "testset"}
                label={
                    deleted
                        ? t("observabilityUi.references.deleted")
                        : testcaseId
                          ? testcaseChipLabel(name, testcaseId)
                          : name
                }
                href={deleted ? null : href}
                openExternally={props.openExternally === true}
                identifiers={{id: testsetId, revisionId, testcaseId}}
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
