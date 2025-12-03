import {memo, useMemo} from "react"

import {Skeleton, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {
    appReferenceAtomFamily,
    previewTestsetReferenceAtomFamily,
    variantConfigAtomFamily,
} from "./atoms/entityReferences"
import ReferenceTag from "./ReferenceTag"

const {Text} = Typography

/**
 * Generic testset tag that fetches and displays a testset reference.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const TestsetTag = memo(
    ({
        testsetId,
        projectId,
        projectURL,
    }: {
        testsetId: string
        projectId: string | null
        projectURL?: string | null
    }) => {
        const queryAtom = useMemo(
            () => previewTestsetReferenceAtomFamily({projectId, testsetId}),
            [projectId, testsetId],
        )
        const query = useAtomValue(queryAtom)

        if (query.isPending || query.isFetching) {
            return <Skeleton.Input active size="small" style={{width: 160}} />
        }

        const ref = query.data
        const label = ref?.name ?? ref?.id ?? testsetId
        const href = projectURL ? `${projectURL}/testsets/${testsetId}` : null

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={label}
                copyValue={testsetId}
                className="max-w-[220px]"
                tone="testset"
            />
        )
    },
)

/**
 * Generic testset tag list that renders multiple testset tags.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const TestsetTagList = memo(
    ({
        ids,
        projectId,
        projectURL,
        className,
    }: {
        ids: string[]
        projectId: string | null
        projectURL?: string | null
        className?: string
    }) => {
        if (!ids.length) {
            return <Text type="secondary">—</Text>
        }

        return (
            <div className={clsx("flex flex-wrap gap-2", className)}>
                {ids.map((id) => (
                    <TestsetTag
                        key={id}
                        testsetId={id}
                        projectId={projectId}
                        projectURL={projectURL}
                    />
                ))}
            </div>
        )
    },
)

/**
 * Generic application reference label that fetches and displays an app reference.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const ApplicationReferenceLabel = memo(
    ({
        applicationId,
        projectId,
        projectURL,
        href: explicitHref,
    }: {
        applicationId: string | null
        projectId: string | null
        projectURL?: string | null
        href?: string | null
    }) => {
        const queryAtom = useMemo(
            () => appReferenceAtomFamily({projectId, appId: applicationId}),
            [projectId, applicationId],
        )
        const query = useAtomValue(queryAtom)

        if (!applicationId) {
            return <Text type="secondary">—</Text>
        }

        if (query.isPending || query.isFetching) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        const label = ref?.name ?? ref?.slug ?? ref?.id ?? applicationId
        const href =
            explicitHref ??
            (projectURL && applicationId ? `${projectURL}/apps/${applicationId}` : null)

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={label}
                copyValue={applicationId ?? undefined}
                className="max-w-[220px]"
                tone="app"
            />
        )
    },
)

/**
 * Generic variant reference label that fetches and displays a variant config reference.
 * Uses revisionId to fetch variant config details.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const VariantReferenceLabel = memo(
    ({
        revisionId,
        projectId,
        fallbackLabel,
        showVersionPill = false,
        explicitVersion,
        href: explicitHref,
    }: {
        revisionId?: string | null
        projectId: string | null
        fallbackLabel?: string | null
        showVersionPill?: boolean
        explicitVersion?: number | string | null
        href?: string | null
    }) => {
        const queryAtom = useMemo(
            () => variantConfigAtomFamily({projectId, revisionId}),
            [projectId, revisionId],
        )
        const query = useAtomValue(queryAtom)

        if (!revisionId) {
            return <Text type="secondary">—</Text>
        }

        if (query.isPending || query.isFetching) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        const label = ref?.variantName ?? fallbackLabel ?? ref?.revisionId ?? revisionId
        const resolvedVersion = explicitVersion ?? ref?.revision ?? null

        return (
            <div className="flex items-center gap-2">
                <ReferenceTag
                    label={label}
                    href={explicitHref ?? undefined}
                    tooltip={label}
                    copyValue={revisionId ?? undefined}
                    className="max-w-[220px]"
                    tone="variant"
                />
                {showVersionPill && resolvedVersion ? (
                    <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5 text-xs font-semibold text-[#344054]">
                        v{resolvedVersion}
                    </span>
                ) : null}
            </div>
        )
    },
)

/**
 * Generic variant reference text (no tag styling, just text).
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const VariantReferenceText = memo(
    ({
        revisionId,
        projectId,
        fallback,
    }: {
        revisionId: string | null
        projectId: string | null
        fallback?: string
    }) => {
        const queryAtom = useMemo(
            () => variantConfigAtomFamily({projectId, revisionId}),
            [projectId, revisionId],
        )
        const query = useAtomValue(queryAtom)

        if (!revisionId) {
            return <Text type="secondary">{fallback ?? "—"}</Text>
        }

        if (query.isPending || query.isFetching) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        const label = ref?.variantName ?? ref?.revisionId ?? revisionId

        return <Text>{label}</Text>
    },
)
