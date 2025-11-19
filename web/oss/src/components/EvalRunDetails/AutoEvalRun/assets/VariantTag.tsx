import {useMemo} from "react"

import {ArrowSquareOut} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {Skeleton, Tag} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import {runIndexFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import type {EnrichedEvaluationRun} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations/types"
import {
    appDetailQueryAtomFamily,
    currentAppContextAtom,
    recentAppIdAtom,
    routerAppIdAtom,
} from "@/oss/state/app"

import {
    combineAppNameWithLabel,
    deriveVariantAppName,
    deriveVariantLabelParts,
    getVariantDisplayMetadata,
    normalizeId,
    normalizeLabel,
} from "./variantUtils"

interface VariantTagProps {
    variantName?: string
    revision?: number | string
    id?: string | null
    className?: string
    isLoading?: boolean
    disabled?: boolean
    isDeleted?: boolean
    enrichedRun?: EnrichedEvaluationRun
    variant?: any
}

const VariantTag = ({
    variantName,
    revision,
    id,
    className,
    isLoading,
    disabled = false,
    isDeleted = false,
    enrichedRun,
    variant,
}: VariantTagProps) => {
    const router = useRouter()
    const queryClient = useQueryClient()
    const setRouterAppId = useSetAtom(routerAppIdAtom)
    const setRecentAppId = useSetAtom(recentAppIdAtom)
    const routeAppId = normalizeId(router.query.app_id as string | undefined)
    const {baseAppURL} = useURL()
    const app = useAtomValue(appDetailQueryAtomFamily(enrichedRun?.appId || null))
    const variantsFromRun = useMemo(() => {
        if (enrichedRun?.variants && Array.isArray(enrichedRun.variants)) {
            return enrichedRun.variants as any[]
        }
        return []
    }, [enrichedRun])

    const normalizedTargetId = useMemo(() => normalizeId(id), [id])
    const normalizedTargetName = useMemo(() => normalizeLabel(variantName), [variantName])

    const variantFromRun = useMemo(() => {
        if (!variantsFromRun.length) return undefined

        const match = variantsFromRun.find((candidate: any) => {
            const candidateIds = [
                normalizeId(candidate?._revisionId),
                normalizeId(candidate?.id),
                normalizeId(candidate?.variantId),
                normalizeId(candidate?.revisionId),
            ].filter(Boolean) as string[]

            if (normalizedTargetId && candidateIds.includes(normalizedTargetId)) {
                return true
            }

            if (normalizedTargetName) {
                const candidateNames = [
                    normalizeLabel(candidate?.variantName),
                    normalizeLabel(candidate?.configName),
                    normalizeLabel(candidate?.name),
                    normalizeLabel(candidate?.variantId),
                ].filter(Boolean) as string[]
                if (candidateNames.includes(normalizedTargetName)) {
                    return true
                }
            }

            return false
        })

        return match ?? variantsFromRun[0]
    }, [variantsFromRun, normalizedTargetId, normalizedTargetName])

    const resolvedVariant = useMemo(() => {
        if (variant) {
            if (variantFromRun) {
                return {
                    ...variantFromRun,
                    ...variant,
                }
            }
            return variant
        }
        return variantFromRun
    }, [variant, variantFromRun])

    const baseLabel =
        normalizeLabel(variantName) ??
        normalizeLabel(resolvedVariant?.variantName) ??
        normalizeLabel(resolvedVariant?.name) ??
        "Variant unavailable"

    const display = useMemo(
        () =>
            getVariantDisplayMetadata(resolvedVariant, {
                fallbackLabel: normalizedTargetName ?? baseLabel,
                fallbackRevisionId: normalizedTargetId,
                requireRuntime: false,
            }),
        [resolvedVariant, normalizedTargetName, baseLabel, normalizedTargetId],
    )

    const {label: preferredLabel, revision: labelRevision} = useMemo(
        () =>
            deriveVariantLabelParts({
                variant: resolvedVariant,
                displayLabel: display.label ?? baseLabel,
            }),
        [resolvedVariant, display.label, baseLabel],
    )

    const variantAppName = useMemo(
        () =>
            deriveVariantAppName({
                variant: resolvedVariant,
                fallbackAppName:
                    (resolvedVariant as any)?.appName ??
                    (resolvedVariant as any)?.application?.name ??
                    (resolvedVariant as any)?.baseName ??
                    enrichedRun?.appName ??
                    (enrichedRun as any)?.app_name ??
                    (enrichedRun as any)?.app?.name,
            }),
        [resolvedVariant, enrichedRun],
    )

    const variantAppId = useMemo(
        () =>
            normalizeId(
                (resolvedVariant as any)?.appId ??
                    (resolvedVariant as any)?.app_id ??
                    (resolvedVariant as any)?.application?.id ??
                    (resolvedVariant as any)?.application_id ??
                    (resolvedVariant as any)?.application_ref?.id ??
                    (resolvedVariant as any)?.applicationRef?.id,
            ),
        [resolvedVariant],
    )

    const runAppId = useMemo(
        () =>
            normalizeId(
                (enrichedRun as any)?.appId ??
                    (enrichedRun as any)?.app_id ??
                    (enrichedRun as any)?.app?.id ??
                    (enrichedRun as any)?.application?.id,
            ),
        [enrichedRun],
    )

    const targetAppId = variantAppId || runAppId || routeAppId
    const resolvedLabel = isDeleted
        ? "Variant deleted"
        : combineAppNameWithLabel(variantAppName, preferredLabel)

    const derivedRevisionId = display.revisionId
    const selectedRevisionId = derivedRevisionId || normalizedTargetId

    const derivedRevision = useMemo(() => {
        if (revision !== undefined && revision !== null && revision !== "") {
            return revision
        }
        const candidate: any = resolvedVariant
        const fromVariant =
            candidate?.revision ??
            candidate?.revisionLabel ??
            candidate?.version ??
            candidate?._revision ??
            undefined
        if (
            fromVariant !== undefined &&
            fromVariant !== null &&
            String(fromVariant).toString().trim() !== ""
        ) {
            return fromVariant
        }
        return labelRevision ?? ""
    }, [resolvedVariant, revision, labelRevision])

    const hasValidRevision = Boolean(selectedRevisionId || labelRevision)
    const isRouteAppContext = Boolean(routeAppId) && targetAppId === routeAppId
    const blockedByRuntime = isRouteAppContext && display.hasRuntime === false

    const canNavigate =
        app?.data?.app_type !== "custom (sdk)" &&
        !isDeleted &&
        Boolean(targetAppId) &&
        hasValidRevision &&
        display.isHealthy !== false &&
        !blockedByRuntime
    const effectiveDisabled = Boolean(disabled) || isDeleted || !canNavigate

    const hasRevision =
        derivedRevision !== undefined &&
        derivedRevision !== null &&
        String(derivedRevision).toString().trim() !== ""

    return (
        <Tag
            bordered={false}
            className={clsx(
                "flex items-center gap-2 bg-[#0517290F] hover:bg-[#05172916] w-fit",
                effectiveDisabled ? "cursor-default" : "cursor-pointer group",
                className,
            )}
            onClick={async () => {
                if (effectiveDisabled || !selectedRevisionId || !targetAppId) return
                setRouterAppId(targetAppId)
                setRecentAppId(targetAppId)

                queryClient.removeQueries({queryKey: ["variants"]})
                queryClient.removeQueries({queryKey: ["appSpec"]})
                queryClient.removeQueries({queryKey: ["variantRevisions"]})

                await router.push({
                    pathname: `${baseAppURL}/${targetAppId}/playground`,
                    query: {
                        revisions: buildRevisionsQueryParam([selectedRevisionId]),
                    },
                })
            }}
        >
            <span>
                {resolvedLabel}
                {hasRevision ? ` v${derivedRevision}` : ""}
            </span>
            {!effectiveDisabled && (
                <ArrowSquareOut
                    size={14}
                    className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
            )}
        </Tag>
    )
}

const VariantTagRouter = ({isLoading, ...props}: VariantTagProps) => {
    if (isLoading) {
        return <Skeleton.Input active className="!w-[90px] !h-[22px]" />
    } else {
        return <VariantTag {...props} />
    }
}

export default VariantTagRouter
