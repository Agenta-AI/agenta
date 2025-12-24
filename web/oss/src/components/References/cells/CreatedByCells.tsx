import {memo, useMemo} from "react"

import {Typography} from "antd"
import {useAtomValue} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"
import dynamic from "next/dynamic"

import {
    useRunRowDetails,
    useRunRowSummary,
} from "@/oss/components/EvaluationRunsTablePOC/context/RunRowDataContext"
import type {EvaluationRunTableRow} from "@/oss/components/EvaluationRunsTablePOC/types"
import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {workspaceMemberByIdFamily} from "@/oss/state/workspace/atoms/selectors"

const UserAvatarTag = dynamic(() => import("@/oss/components/CustomUIs/UserAvatarTag"), {
    ssr: false,
})

const CELL_CLASS =
    "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2 whitespace-nowrap overflow-hidden"

export const PreviewCreatedByCellSkeleton = () => <SkeletonLine width="50%" />

const resolvePreviewCreatorName = (run: any): string | null => {
    if (!run) return null
    const candidates = [
        run.createdBy,
        run.created_by,
        run.createdByUser,
        run.created_by_user,
        run.owner,
        run.user,
        run.creator,
    ].filter(Boolean)

    for (const candidate of candidates) {
        const username =
            candidate?.user?.username ??
            candidate?.user?.name ??
            candidate?.user?.email ??
            candidate?.username ??
            candidate?.name ??
            candidate?.email
        if (typeof username === "string" && username.trim().length > 0) {
            return username.trim()
        }
    }

    return null
}

const resolveWorkspaceMemberName = (member: any | null | undefined) => {
    if (!member) return null
    const candidate =
        member.user?.username ?? member.user?.name ?? member.user?.email ?? member.user?.id
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null
}

const normalize = (value: string | null | undefined) =>
    typeof value === "string" && value.trim().length ? value.trim().toLowerCase() : null

const normalizeMemberFullName = (member?: {user?: unknown} | null) => {
    const raw =
        member && member.user && typeof member.user === "object"
            ? ((member.user as {name?: string | null})?.name ?? null)
            : null
    return normalize(raw)
}

const PreviewCreatedByCellContent = ({
    record,
    isVisible,
}: {
    record: EvaluationRunTableRow
    isVisible: boolean
}) => {
    const {summary, isLoading: summaryLoading} = useRunRowSummary(record, isVisible)
    const {camelRun, isLoading: detailsLoading} = useRunRowDetails(record, isVisible)
    // const store = useStore()

    const candidateUserId =
        summary?.createdById ??
        camelRun?.createdById ??
        camelRun?.created_by_id ??
        camelRun?.createdBy?.id ??
        camelRun?.created_by?.id ??
        camelRun?.createdByUser?.id ??
        camelRun?.created_by_user?.id ??
        null

    const memberAtom = useMemo(
        () => workspaceMemberByIdFamily(candidateUserId ?? null),
        [candidateUserId],
    )
    // const member = useAtomValueWithSchedule(memberAtom, {priority: LOW_PRIORITY})
    const member = useAtomValue(memberAtom)
    const currentUser = useAtomValueWithSchedule(userAtom, {priority: LOW_PRIORITY})

    if (summaryLoading || detailsLoading) {
        return <PreviewCreatedByCellSkeleton />
    }

    const memberName = resolveWorkspaceMemberName(member)
    const runName = resolvePreviewCreatorName(camelRun)

    const createdBy = memberName ?? runName ?? null
    const createdByNormalized = normalize(createdBy)

    const candidateIds = (
        [
            candidateUserId,
            member?.user?.id ?? null,
            camelRun?.createdById ?? null,
            camelRun?.created_by_id ?? null,
        ].filter(Boolean) as string[]
    ).map((value) => value.trim())

    const candidateNames = [
        createdByNormalized,
        normalize(member?.user?.username),
        normalize(member?.user?.email),
        normalizeMemberFullName(member),
        normalize(runName),
    ].filter(Boolean) as string[]

    const currentUsername = normalize(currentUser?.username)
    const currentEmail = normalize(currentUser?.email)

    const isCurrentUser = Boolean(
        currentUser &&
            ((currentUser.id && candidateIds.includes(currentUser.id)) ||
                (currentUsername && candidateNames.includes(currentUsername)) ||
                (currentEmail && candidateNames.includes(currentEmail))),
    )

    if (!createdBy) {
        return <Typography.Text>—</Typography.Text>
    }

    return <UserAvatarTag modifiedBy={createdBy} isCurrentUser={isCurrentUser} />
}

export const PreviewCreatedByCell = memo(
    ({record, isVisible = true}: {record: EvaluationRunTableRow; isVisible?: boolean}) => {
        if (record.__isSkeleton) {
            return (
                <div className={CELL_CLASS}>
                    <PreviewCreatedByCellSkeleton />
                </div>
            )
        }

        return (
            <div className={CELL_CLASS}>
                <PreviewCreatedByCellContent record={record} isVisible={isVisible} />
            </div>
        )
    },
)

export default PreviewCreatedByCell
