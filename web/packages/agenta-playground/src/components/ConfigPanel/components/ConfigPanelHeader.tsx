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

import {useRunnable, type RunnableType, type AppRevisionData} from "@agenta/entities/runnable"
import {VersionBadge} from "@agenta/ui"
import {Lightning, PencilSimple, X} from "@phosphor-icons/react"
import {Button, Space, Tag, Typography} from "antd"

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
    const runnable = useRunnable(type, entity.id)

    const getStatusTag = () => {
        if (runnable.isPending) {
            return <Tag color="warning">Loading...</Tag>
        }
        if (runnable.isError) {
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
                                (runnable.data as AppRevisionData)?.revision !== undefined && (
                                    <VersionBadge
                                        version={(runnable.data as AppRevisionData).revision}
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
                            disabled={!runnable.isDirty}
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
