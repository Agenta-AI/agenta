/**
 * CreateAppTypeModal
 *
 * Onboarding modal that surfaces the two built-in app types (Chat /
 * Completion) as large, equal-weight choices. Used by the welcome-card
 * "Create a prompt" entry on the home page so first-time users explicitly
 * pick a type rather than landing on a Chat default.
 *
 * The repeat-user dropdown next to the apps table (`CreateAppDropdown`)
 * keeps a compact list-style picker; this modal is intentionally heavier
 * for the onboarding context.
 *
 * On selection: mints a `local-*` ephemeral via
 * `createEphemeralAppFromTemplate` and opens the unified
 * `WorkflowRevisionDrawer` with `context: "app-create"`. Navigation on
 * commit is owned by the drawer wrapper — no `onWorkflowCreated` callback
 * needed here.
 */
import {memo, useCallback, useRef, useState, useTransition} from "react"

import {createEphemeralAppFromTemplate, type AppType} from "@agenta/entities/workflow"
import {openWorkflowRevisionDrawerAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {cn, textColors, borderColors} from "@agenta/ui"
import {ArrowRight} from "@phosphor-icons/react"
import {Typography, message} from "antd"
import {useSetAtom} from "jotai"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import {getAppTypeIcon} from "../../../prompts/assets/iconHelpers"

const {Title, Text} = Typography

interface CreateAppTypeOption {
    type: AppType
    label: string
    description: string
    testId: string
}

const OPTIONS: CreateAppTypeOption[] = [
    {
        type: "chat",
        label: "Chat",
        description: "Conversational app with message history.",
        testId: "create-app-type-modal-chat",
    },
    {
        type: "completion",
        label: "Completion",
        description: "Single-shot prompt completion.",
        testId: "create-app-type-modal-completion",
    },
]

interface CreateAppTypeModalProps {
    open: boolean
    onCancel: () => void
}

const CreateAppTypeModal = ({open, onCancel}: CreateAppTypeModalProps) => {
    const [isPending, startTransition] = useTransition()
    const inflightRef = useRef<AbortController | null>(null)
    const [activeType, setActiveType] = useState<AppType | null>(null)

    const setOpenDrawer = useSetAtom(openWorkflowRevisionDrawerAtom)

    const handleSelect = useCallback(
        (option: CreateAppTypeOption) => {
            if (isPending) return

            // Cancel any prior in-flight request (rapid double-click).
            inflightRef.current?.abort()
            const controller = new AbortController()
            inflightRef.current = controller
            setActiveType(option.type)

            startTransition(async () => {
                try {
                    const entityId = await createEphemeralAppFromTemplate({
                        type: option.type,
                        signal: controller.signal,
                    })
                    if (controller.signal.aborted) return
                    if (!entityId) {
                        message.error("Couldn't start app creation — please retry")
                        return
                    }
                    onCancel()
                    setOpenDrawer({
                        entityId,
                        context: "app-create",
                    })
                } finally {
                    if (inflightRef.current === controller) inflightRef.current = null
                    setActiveType(null)
                }
            })
        },
        [isPending, onCancel, setOpenDrawer],
    )

    return (
        <EnhancedModal
            open={open}
            onCancel={onCancel}
            footer={null}
            width={520}
            centered
            destroyOnClose
            data-testid="create-app-type-modal"
        >
            <div className="flex flex-col gap-2 mb-6">
                <Title level={4} className="!mb-0">
                    Create a new prompt
                </Title>
                <Text type="secondary">Choose the type of app you want to build.</Text>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {OPTIONS.map((option) => {
                    const disabled = isPending
                    const isActive = activeType === option.type
                    return (
                        <button
                            key={option.type}
                            type="button"
                            disabled={disabled}
                            onClick={() => handleSelect(option)}
                            className={cn(
                                "appearance-none bg-transparent text-left w-full",
                                "border border-solid",
                                borderColors.secondary,
                                "rounded-lg p-4 flex flex-col gap-2",
                                "transition-all duration-150 ease-in-out",
                                "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                                disabled
                                    ? "cursor-not-allowed opacity-60"
                                    : "cursor-pointer hover:border-blue-500 hover:shadow-sm",
                                isActive && "border-blue-500 shadow-sm",
                            )}
                            data-testid={option.testId}
                        >
                            <div className="flex items-center justify-between">
                                <span
                                    className={cn(
                                        "flex items-center justify-center",
                                        "w-9 h-9 rounded-md",
                                        "border border-solid",
                                        borderColors.secondary,
                                        textColors.primary,
                                    )}
                                >
                                    {getAppTypeIcon(option.type)}
                                </span>
                                <ArrowRight
                                    size={14}
                                    className={cn(
                                        textColors.tertiary,
                                        "transition-transform duration-150",
                                        !disabled && "group-hover:translate-x-0.5",
                                    )}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <Text className="font-medium">{option.label}</Text>
                                <Text type="secondary" className="text-xs">
                                    {option.description}
                                </Text>
                            </div>
                        </button>
                    )
                })}
            </div>
        </EnhancedModal>
    )
}

export default memo(CreateAppTypeModal)
