import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import referencesCatalog from "@agenta/i18n/catalogs/observabilityUi.references"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import {useEvaluatorNavigation} from "@agenta/observability/traceDrawer"
import {linksAndReferencesAtom, traceDrawerProjectURLAtom} from "@agenta/observability/traceDrawer"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {
    mergeReferenceChips,
    type MergedReferenceChip,
    type TraceReference,
} from "../references/mergeReferenceChips"

import {getTraceDrawerReferences} from "./referenceSlots"

// The side panel hugs the right edge of the screen, so hovercards open leftward.
const HOVERCARD_PLACEMENT = "bottomRight" as const

const LABEL_KEYS = {
    app: "observabilityUi.references.application",
    environment: "observabilityUi.references.environment",
    evaluator: "observabilityUi.references.evaluator",
    testcase: "observabilityUi.references.testCase",
    testset: "observabilityUi.references.testSet",
} as const

/** The merged reference chips of the open trace: one per entity. Empty when it has none. */
export const useTraceReferenceChips = (): MergedReferenceChip[] => {
    const linksAndReferences = useAtomValue(linksAndReferencesAtom)
    return useMemo(
        () => mergeReferenceChips((linksAndReferences?.references ?? []) as TraceReference[]),
        [linksAndReferences?.references],
    )
}

/**
 * The References section of the side panel: one chip per entity (an application with its
 * variant and version, an environment, an evaluator, a test case), each beside its label. The
 * chips are the host's reference slots, with their hover cards and links.
 */
const TraceReferences = () => {
    const t = useT(drawerCatalog, referencesCatalog)
    const {
        ApplicationReferenceLabel,
        EnvironmentReferenceLabel,
        EvaluatorReferenceLabel,
        TestsetTag,
        VariantReferenceLabel,
    } = getTraceDrawerReferences()
    const projectURL = useAtomValue(traceDrawerProjectURLAtom)
    const projectId = useAtomValue(projectIdAtom)
    const {buildEvaluatorTarget} = useEvaluatorNavigation()
    const chips = useTraceReferenceChips()
    const appChip = chips.find((chip) => chip.kind === "app")

    if (!chips.length) return null

    const renderChip = (chip: MergedReferenceChip) => {
        const id = chip.entity?.id ?? undefined
        const slug = chip.entity?.slug ?? undefined
        switch (chip.kind) {
            case "app": {
                // With a revision, the variant chip names the variant and its version and links
                // to it; without one, the application chip.
                const revisionId = chip.revision?.id
                if (!revisionId) {
                    return (
                        <ApplicationReferenceLabel
                            applicationId={id ?? null}
                            projectId={projectId}
                            projectURL={projectURL}
                            label={slug}
                            openExternally
                            hovercardPlacement={HOVERCARD_PLACEMENT}
                        />
                    )
                }
                const applicationId = id || slug
                const href =
                    projectURL && applicationId
                        ? `${projectURL}/apps/${encodeURIComponent(
                              applicationId,
                          )}/variants?revisionId=${encodeURIComponent(revisionId)}`
                        : undefined
                return (
                    <VariantReferenceLabel
                        revisionId={revisionId}
                        projectId={projectId}
                        showVersionPill
                        href={href}
                        fallbackLabel={chip.variant?.slug ?? slug}
                        openExternally
                        hovercardPlacement={HOVERCARD_PLACEMENT}
                    />
                )
            }
            case "environment":
                return (
                    <EnvironmentReferenceLabel
                        environmentId={id}
                        environmentSlug={slug}
                        applicationId={appChip?.entity?.id}
                        projectId={projectId}
                        projectURL={projectURL}
                        label={slug}
                        openExternally
                        hovercardPlacement={HOVERCARD_PLACEMENT}
                    />
                )
            case "evaluator":
                return (
                    <EvaluatorReferenceLabel
                        evaluatorId={id}
                        evaluatorSlug={slug}
                        projectId={projectId}
                        href={buildEvaluatorTarget({id, slug})?.href ?? undefined}
                        label={slug}
                        openExternally
                        hovercardPlacement={HOVERCARD_PLACEMENT}
                    />
                )
            case "testcase":
            case "testset":
                return (
                    <TestsetTag
                        testsetId={id}
                        revisionId={chip.revision?.id ?? undefined}
                        testcaseId={chip.testcase?.id ?? undefined}
                        projectId={projectId}
                        projectURL={projectURL}
                        openExternally
                        hovercardPlacement={HOVERCARD_PLACEMENT}
                    />
                )
        }
    }

    return (
        <section className="flex flex-col gap-2" data-testid="trace-references">
            <h3 className="m-0 text-label">{t("observabilityUi.traceDrawer.references")}</h3>
            <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-2 gap-y-2">
                {chips.map((chip) => (
                    <div key={chip.kind} className="contents">
                        <dt className="text-meta text-muted-foreground">
                            {t(LABEL_KEYS[chip.kind])}
                        </dt>
                        <dd className="m-0 min-w-0">{renderChip(chip)}</dd>
                    </div>
                ))}
            </dl>
        </section>
    )
}

export default TraceReferences
