/**
 * ConfigPanelHeader Component
 *
 * Header section of the ConfigPanel displaying:
 * - Entity icon and name
 * - Version badge (for app revisions)
 * - Status tag (loading/error/ready)
 * - Commit button (for app revisions)
 * - Change and Remove buttons
 */

import {useMemo} from "react"

import {runnableBridge, type RunnableType, type AppRevisionData} from "@agenta/entities/runnable"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {Lightning, PencilSimple, X} from "@phosphor-icons/react"
import {Button, Space, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import {usePlaygroundUI} from "../../../context"
import type {EntitySelection} from "../../EntitySelector"

const {Text} = Typography

export interface ConfigPanelHeaderProps {
    /** The selected entity */
    entity: EntitySelection
    /** Callback to remove the entity */
    onRemove: () => void
    /** Callback to change the entity */
    onChange?: () => void
}

export function ConfigPanelHeader({entity, onRemove, onChange}: ConfigPanelHeaderProps) {
    const {CommitVariantChangesButton} = usePlaygroundUI()

    const type = entity.type as RunnableType

    // Use bridge selectors for runnable data access
    const dataAtom = useMemo(() => runnableBridge.data(entity.id), [entity.id])
    const queryAtom = useMemo(() => runnableBridge.query(entity.id), [entity.id])
    const isDirtyAtom = useMemo(() => runnableBridge.isDirty(entity.id), [entity.id])

    const data = useAtomValue(dataAtom)
    const query = useAtomValue(queryAtom)
    const isDirty = useAtomValue(isDirtyAtom)

    const getStatusTag = () => {
        if (query.isPending) {
            return <Tag color="warning">Loading...</Tag>
        }
        if (query.isError) {
            return <Tag color="error">Error</Tag>
        }
        return <Tag color="success">Ready</Tag>
    }

    return (
        <div className="px-4 py-3 border-b border-gray-200 bg-white sticky top-0 z-10">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Lightning size={16} weight="fill" className="text-blue-600" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <Text strong className="text-base">
                                {entity.label}
                            </Text>
                            {type === "appRevision" &&
                                typeof (data as AppRevisionData)?.revision === "number" && (
                                    <VersionBadge
                                        version={(data as AppRevisionData).revision as number}
                                        variant="chip"
                                    />
                                )}
                            {getStatusTag()}
                        </div>
                        <Text type="secondary" className="text-xs capitalize">
                            {entity.type}
                        </Text>
                    </div>
                </div>
                <Space>
                    {type === "appRevision" && (
                        <CommitVariantChangesButton
                            variantId={entity.id}
                            label="Commit"
                            size="small"
                            disabled={!isDirty}
                            commitType="parameters"
                        />
                    )}
                    {onChange && (
                        <Button
                            type="text"
                            icon={<PencilSimple size={16} />}
                            onClick={onChange}
                            title="Change"
                        />
                    )}
                    <Button
                        type="text"
                        danger
                        icon={<X size={16} />}
                        onClick={onRemove}
                        title="Remove"
                    />
                </Space>
            </div>
        </div>
    )
}
