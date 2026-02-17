import {memo, useCallback, useMemo} from "react"

import {baseRunnableMolecule} from "@agenta/entities/baseRunnable"
import {message} from "@agenta/ui/app-message"
import {DraftTag} from "@agenta/ui/components"
import {Plus, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip, Typography} from "antd"
import type {MenuProps} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {DrillInContent} from "@/oss/components/DrillInView/DrillInContent"

interface BaseRunnableConfigSectionProps {
    entityId: string
}

function BaseRunnableConfigSection({entityId}: BaseRunnableConfigSectionProps) {
    const data = useAtomValue(
        useMemo(() => baseRunnableMolecule.selectors.data(entityId), [entityId]),
    )
    const isDirty = useAtomValue(
        useMemo(() => baseRunnableMolecule.selectors.isDirty(entityId), [entityId]),
    )
    const discardChanges = useSetAtom(baseRunnableMolecule.reducers.discard)

    const parameters = data?.parameters ?? {}
    const hasParameters = Object.keys(parameters).length > 0

    const handleDiscard = useCallback(() => {
        discardChanges(entityId)
    }, [discardChanges, entityId])

    // Create handlers for app/evaluator creation (no-op for now)
    const handleCreateApp = useCallback(() => {
        message.info("Create App from trace - coming soon")
        // TODO: Implement app creation from baseRunnable config
    }, [])

    const handleCreateEvaluator = useCallback(() => {
        message.info("Create Evaluator from trace - coming soon")
        // TODO: Implement evaluator creation from baseRunnable config
    }, [])

    const createMenuItems: MenuProps["items"] = useMemo(
        () => [
            {
                key: "app",
                label: "Create App",
                onClick: handleCreateApp,
            },
            {
                key: "evaluator",
                label: "Create Evaluator",
                onClick: handleCreateEvaluator,
            },
        ],
        [handleCreateApp, handleCreateEvaluator],
    )

    const getValue = useCallback(
        (path: string[]): unknown => {
            let current: unknown = parameters
            for (const key of path) {
                if (current == null || typeof current !== "object") return undefined
                current = (current as Record<string, unknown>)[key]
            }
            return current
        },
        [parameters],
    )

    const updateDraft = useSetAtom(baseRunnableMolecule.reducers.update)

    const setValue = useCallback(
        (path: string[], value: unknown) => {
            if (path.length === 0 || !data) return
            // Build updated parameters by setting value at path
            // Must preserve arrays vs objects during immutable cloning
            const updated = {...parameters}
            let target: Record<string, unknown> = updated
            for (let i = 0; i < path.length - 1; i++) {
                const key = path[i]
                const next = target[key]
                if (Array.isArray(next)) {
                    target[key] = [...next]
                    target = target[key] as unknown as Record<string, unknown>
                } else if (next && typeof next === "object") {
                    target[key] = {...(next as Record<string, unknown>)}
                    target = target[key] as Record<string, unknown>
                } else {
                    target[key] = {}
                    target = target[key] as Record<string, unknown>
                }
            }
            target[path[path.length - 1]] = value

            // Update the draft (not the base data) so isDirty becomes true
            updateDraft(entityId, updated)
        },
        [parameters, entityId, data, updateDraft],
    )

    const getRootItems = useCallback(() => {
        return Object.keys(parameters)
            .sort()
            .map((key) => ({
                key,
                name: key,
                value: parameters[key],
                isColumn: false,
            }))
    }, [parameters])

    return (
        <>
            <section className="flex items-center justify-between h-[48px] px-3 border-0 border-b border-solid border-[rgba(5,23,41,0.06)] bg-white sticky top-0 z-10">
                <div className="flex items-center gap-2">
                    <Typography.Text strong>{data?.label ?? "Trace Replay"}</Typography.Text>
                    {isDirty && <DraftTag />}
                </div>
                <div className="flex items-center gap-2">
                    {isDirty && (
                        <Tooltip title="Discard changes">
                            <Button
                                type="text"
                                size="small"
                                danger
                                icon={<Trash size={16} />}
                                onClick={handleDiscard}
                            />
                        </Tooltip>
                    )}
                    <Dropdown menu={{items: createMenuItems}} trigger={["click"]}>
                        <Button type="primary" size="small" icon={<Plus size={14} />}>
                            Create
                        </Button>
                    </Dropdown>
                </div>
            </section>
            {hasParameters ? (
                <div className="flex-1 overflow-auto p-3">
                    <DrillInContent
                        getValue={getValue}
                        setValue={setValue}
                        getRootItems={getRootItems}
                        rootTitle="Configuration"
                        editable
                        valueMode="native"
                    />
                </div>
            ) : (
                <div className="px-3 py-4 text-[rgba(0,0,0,0.45)] text-sm">
                    No configuration parameters
                </div>
            )}
        </>
    )
}

export default memo(BaseRunnableConfigSection)
