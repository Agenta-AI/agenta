import {useMemo, useState} from "react"

import {evaluationRunQueryAtomFamily} from "@agenta/evaluations/state/evalRun"
import {DownOutlined} from "@ant-design/icons"
import {PencilSimple} from "@phosphor-icons/react"
import {Button, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import ReadOnlyBox from "@/oss/components/pages/evaluations/onlineEvaluation/components/ReadOnlyBox"

import {editEvaluationDrawerRunIdAtom} from "../../../../state/editDrawer"
import {deriveRunTags} from "../utils"

import {SectionHeaderRow, SectionSkeleton} from "./SectionPrimitives"

const {Text} = Typography

interface GeneralSectionProps {
    runId: string
    /** When true, show the "Edit" trigger that opens the run-edit drawer. */
    showActions?: boolean
    showHeader?: boolean
}

const GeneralSectionHeader = () => (
    <div className="flex flex-col gap-1">
        <Text className="text-sm font-semibold text-[var(--ag-c-344054)]">General</Text>
    </div>
)

const Field = ({
    label,
    children,
    className,
}: {
    label: string
    children: React.ReactNode
    className?: string
}) => (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
        <Text className="text-xs font-medium text-[var(--ag-c-475467)]">{label}</Text>
        {children}
    </div>
)

/**
 * Read-only view of the run's metadata. Editing is no longer inline — it goes through the
 * shared "Edit evaluation" drawer (consistent with the header actions dropdown and the
 * Add-evaluator button), opened via the Edit trigger here.
 */
const GeneralSection = ({runId, showActions = true, showHeader = true}: GeneralSectionProps) => {
    const [collapsed, setCollapsed] = useState(false)
    const openEditDrawer = useSetAtom(editEvaluationDrawerRunIdAtom)
    const runQueryAtom = useMemo(() => evaluationRunQueryAtomFamily(runId), [runId])
    const runQuery = useAtomValue(runQueryAtom)
    const isLoading = runQuery.isPending && !runQuery.data

    const runData = runQuery.data?.camelRun ?? runQuery.data?.rawRun ?? null
    const runMeta = (runData?.meta ?? {}) as Record<string, unknown>
    const runName = typeof runData?.name === "string" ? runData.name : ""
    const runSlug =
        typeof runData?.slug === "string"
            ? runData.slug
            : typeof runMeta?.slug === "string"
              ? (runMeta.slug as string)
              : null
    const runDescription =
        typeof runData?.description === "string"
            ? runData.description
            : typeof runMeta?.description === "string"
              ? (runMeta.description as string)
              : null
    const runTags = useMemo(
        () => deriveRunTags(runData?.tags, runMeta?.tags),
        [runData?.tags, runMeta?.tags],
    )

    if (isLoading) {
        return <SectionSkeleton lines={4} />
    }

    const showBody = !collapsed || !showHeader

    return (
        <div className="flex flex-col">
            {showHeader ? (
                <SectionHeaderRow
                    left={<GeneralSectionHeader />}
                    right={
                        <Button
                            type="text"
                            size="small"
                            icon={
                                <DownOutlined rotate={collapsed ? -90 : 0} style={{fontSize: 12}} />
                            }
                            onClick={() => setCollapsed((v) => !v)}
                        />
                    }
                />
            ) : null}
            {showBody ? (
                <div className="relative mt-1 flex flex-col gap-3">
                    {showActions ? (
                        // Float in the section's top-right so it doesn't push the fields down.
                        <Button
                            size="small"
                            icon={<PencilSimple size={14} />}
                            onClick={() => openEditDrawer(runId)}
                            className="absolute right-0 top-0 z-10"
                        >
                            Edit
                        </Button>
                    ) : null}
                    {/* pr keeps a long name from sliding under the floating Edit button */}
                    <Field label="Name" className={showActions ? "pr-20" : undefined}>
                        <Text>{runName || "—"}</Text>
                        {runSlug ? (
                            <Text type="secondary" className="text-xs">
                                Slug: {runSlug}
                            </Text>
                        ) : null}
                    </Field>
                    <Field label="Description">
                        {runDescription ? (
                            <Text className="whitespace-pre-wrap">{runDescription}</Text>
                        ) : (
                            <Text type="secondary">No description</Text>
                        )}
                    </Field>
                    <Field label="Tags">
                        {runTags.length ? (
                            <ReadOnlyBox>
                                <div className="flex flex-wrap gap-1">
                                    {runTags.map((tag) => (
                                        <Tag key={tag} className="!m-0">
                                            {tag}
                                        </Tag>
                                    ))}
                                </div>
                            </ReadOnlyBox>
                        ) : (
                            <Text type="secondary">No tags</Text>
                        )}
                    </Field>
                </div>
            ) : null}
        </div>
    )
}

export default GeneralSection
