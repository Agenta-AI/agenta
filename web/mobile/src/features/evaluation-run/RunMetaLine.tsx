import type {ReactNode} from "react"

import {
    formatQueryFiltering,
    formatQuerySampleRate,
    runQueryConfigQueryAtomFamily,
    runReferencesAtomFamily,
    type RunHeader,
} from "@agenta/entities/evaluationRun"
import {formatDate, useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"
import Link from "next/link"

import {RunStatusTag} from "./overview/RunStatusTag"
import {useOverviewNames} from "./overview/useRunOverview"
import {useRunReferenceLinks} from "./overview/useRunReferenceLinks"

const NO_QUERY = {queryId: "", revisionId: null}

/** A name with its version, as a link when its page is on. */
const Reference = ({
    name,
    version,
    href,
}: {
    name: string
    version?: number | null
    href?: string | null
}) => {
    const body = (
        <>
            {name}
            {version !== null && version !== undefined ? (
                <>
                    {" "}
                    <VersionBadge version={version} size="small" />
                </>
            ) : null}
        </>
    )
    return href ? (
        <Link href={href} prefetch={false} className="text-link no-underline hover:underline">
            {body}
        </Link>
    ) : (
        <span className="text-foreground">{body}</span>
    )
}

/**
 * The run facts under the title, on every tab: status, test set, application, variant, created
 * date, and a live run's query and sample rate.
 */
export const RunMetaLine = ({runId, header}: {runId: string; header: RunHeader}) => {
    const t = useT(runOverviewCatalog)
    const references = useAtomValue(runReferencesAtomFamily(runId))
    const links = useRunReferenceLinks()
    const queryConfig = useAtomValue(
        runQueryConfigQueryAtomFamily(references?.queries[0] ?? NO_QUERY),
    )
    const names = useOverviewNames({
        evaluatorIds: [],
        testsetIds: references?.testsets.map((testset) => testset.testsetId) ?? [],
        testsetRevisionIds:
            references?.testsets.map((testset) =>
                testset.version === null ? (testset.revisionId ?? "") : "",
            ) ?? [],
        applicationId: references?.applicationId ?? null,
        revisionId: references?.revisionId ?? null,
    })

    const items: {key: string; node: ReactNode}[] = []
    references?.testsets.forEach((testset, index) => {
        items.push({
            key: `testset-${index}`,
            node: (
                <>
                    {t("evaluations.runOverview.testSet")}{" "}
                    <Reference
                        name={names.testsets[index] ?? testset.testsetId}
                        version={testset.version ?? names.testsetVersions?.[index] ?? null}
                        href={testset.revisionId ? links.testset(testset.revisionId) : null}
                    />
                </>
            ),
        })
    })
    const applicationId = references?.applicationId
    if (applicationId) {
        items.push({
            key: "application",
            node: (
                <>
                    {t("evaluations.runOverview.application")}{" "}
                    <Reference name={names.application ?? applicationId} />
                </>
            ),
        })
        if (names.variant) {
            const revisionId = references.revisionId
            items.push({
                key: "variant",
                node: (
                    <>
                        {t("evaluations.runOverview.variant")}{" "}
                        <Reference
                            name={names.variant}
                            version={references.revisionVersion ?? names.revisionVersion ?? null}
                            href={revisionId ? links.variant(applicationId, revisionId) : null}
                        />
                    </>
                ),
            })
        }
    }
    if ((references?.queries.length ?? 0) > 0 && !queryConfig.isPending) {
        const filter = formatQueryFiltering(queryConfig.data?.filtering)
        const rate = t("evaluations.runOverview.sampleRate", {
            rate: formatQuerySampleRate(queryConfig.data?.rate),
        })
        items.push({
            key: "query",
            node: (
                <span className="block max-w-80 truncate" title={filter}>
                    {t("evaluations.runOverview.query")}{" "}
                    <span className="text-foreground">{filter}</span>
                </span>
            ),
        })
        items.push({key: "rate", node: rate})
    }
    if (header.createdAt) {
        items.push({
            key: "created",
            node: formatDate(new Date(header.createdAt), {dateStyle: "medium", timeStyle: "short"}),
        })
    }

    return (
        <div
            data-testid="run-meta-line"
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground"
        >
            <RunStatusTag status={header.status} />
            {items.map((item) => (
                <span key={item.key} data-testid={`meta-${item.key}`} className="min-w-0">
                    {item.node}
                </span>
            ))}
        </div>
    )
}
