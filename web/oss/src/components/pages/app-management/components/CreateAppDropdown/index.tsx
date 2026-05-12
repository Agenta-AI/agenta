import {memo, useCallback, useMemo, useRef, useState, useTransition} from "react"

import {
    appTemplatesQueryAtom,
    createEphemeralAppFromTemplate,
    type AppType,
} from "@agenta/entities/workflow"
import {openWorkflowRevisionDrawerAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {cn, textColors, bgColors, borderColors} from "@agenta/ui"
import {PlusOutlined} from "@ant-design/icons"
import {ArrowRight} from "@phosphor-icons/react"
import {Button, Popover, Typography, message} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {getAppTypeIcon} from "../../../prompts/assets/iconHelpers"

interface CreateAppDropdownItem {
    type: AppType
    label: string
    description: string
    testId: string
}

const ITEMS: CreateAppDropdownItem[] = [
    {
        type: "chat",
        label: "Chat",
        description: "Conversational app with message history.",
        testId: "create-app-dropdown-chat",
    },
    {
        type: "completion",
        label: "Completion",
        description: "Single-shot prompt completion.",
        testId: "create-app-dropdown-completion",
    },
]

interface CreateAppDropdownProps {
    /** Custom trigger element (defaults to "Create New Prompt" button) */
    trigger?: React.ReactNode
    /** Additional class name for the trigger wrapper */
    className?: string
}

/**
 * Dropdown for creating a new app. Replaces the legacy `AddAppFromTemplateModal`.
 *
 * Chat / Completion: mints a `local-*` ephemeral via `createEphemeralAppFromTemplate`,
 * opens `WorkflowRevisionDrawer` with `context: "app-create"`. Commit promotes
 * ephemeral → real app + variant + v1 in one server call, drawer closes, user
 * lands on `/apps/<new_app_id>/playground?revisions=<new_revision_id>`.
 *
 * Custom workflow has its own entry point ("Set up workflow" in the prompts
 * breadcrumb / table action menu) and is intentionally not surfaced here.
 *
 * Race guard: rapid double-click is handled with `useTransition` + `AbortController`.
 * While a factory call is in-flight, dropdown items are disabled and any newer
 * click aborts the prior request before the drawer opens for the wrong type.
 */
const CreateAppDropdown = ({trigger, className}: CreateAppDropdownProps) => {
    const [open, setOpen] = useState(false)
    const [isPending, startTransition] = useTransition()
    const inflightRef = useRef<AbortController | null>(null)

    const setOpenDrawer = useSetAtom(openWorkflowRevisionDrawerAtom)

    // Pre-fetch the catalog templates as soon as the dropdown mounts so the
    // factory has data ready when the user clicks Chat / Completion. Without
    // this subscription, the templates query is lazy and the first click
    // pays the full fetch latency before the drawer can open.
    useAtomValue(appTemplatesQueryAtom)

    const handleSelect = useCallback(
        (item: CreateAppDropdownItem) => {
            if (isPending) return
            setOpen(false)

            // Cancel any prior in-flight request (rapid double-click pre-pending).
            inflightRef.current?.abort()
            const controller = new AbortController()
            inflightRef.current = controller
            const appType: AppType = item.type

            startTransition(async () => {
                try {
                    const entityId = await createEphemeralAppFromTemplate({
                        type: appType,
                        signal: controller.signal,
                    })
                    if (controller.signal.aborted) return
                    if (!entityId) {
                        message.error("Couldn't start app creation — please retry")
                        return
                    }
                    // The drawer wrapper owns navigation for `app-create`
                    // (see `useDrawerCreateCommitCallback`) — it closes the
                    // drawer and pushes to /apps/<id>/playground in one
                    // transition. Avoid passing `onWorkflowCreated` here so
                    // we don't double-navigate.
                    setOpenDrawer({
                        entityId,
                        context: "app-create",
                    })
                } finally {
                    if (inflightRef.current === controller) inflightRef.current = null
                }
            })
        },
        [isPending, setOpenDrawer],
    )

    const popoverContent = useMemo(
        () => (
            <div className="w-[380px]" data-testid="create-app-dropdown-content">
                <div className="px-4 pt-3 pb-2">
                    <Typography.Text className="text-[14px] leading-[22px] font-[500]">
                        Select app type
                    </Typography.Text>
                </div>
                <div className="flex flex-col">
                    {ITEMS.map((item) => {
                        const disabled = isPending
                        return (
                            <button
                                key={item.type}
                                type="button"
                                onClick={() => !disabled && handleSelect(item)}
                                disabled={disabled}
                                className={cn(
                                    "appearance-none bg-transparent text-left w-full",
                                    "border-0 border-b border-solid last:border-b-0",
                                    borderColors.secondary,
                                    "min-h-[56px] flex items-center gap-3 py-2 px-4",
                                    "group transition-colors",
                                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                                    disabled
                                        ? "cursor-not-allowed opacity-50"
                                        : cn("cursor-pointer", bgColors.hoverState),
                                )}
                                data-testid={item.testId}
                            >
                                <span
                                    className={cn(
                                        "flex-shrink-0 flex items-center",
                                        textColors.tertiary,
                                    )}
                                >
                                    {getAppTypeIcon(item.type)}
                                </span>
                                <div className="flex flex-col gap-1 min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <Typography.Text className="text-xs font-medium">
                                            {item.label}
                                        </Typography.Text>
                                        {!disabled && (
                                            <ArrowRight
                                                size={12}
                                                className={cn(
                                                    textColors.tertiary,
                                                    "opacity-0 group-hover:opacity-100",
                                                    "-translate-x-2 group-hover:translate-x-0",
                                                    "transition-all duration-200 ease-in-out",
                                                )}
                                            />
                                        )}
                                    </div>
                                    <Typography.Text
                                        className={cn("text-xs line-clamp-1", textColors.tertiary)}
                                    >
                                        {item.description}
                                    </Typography.Text>
                                </div>
                            </button>
                        )
                    })}
                </div>
            </div>
        ),
        [handleSelect, isPending],
    )

    const defaultTrigger = (
        <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={isPending}
            data-testid="create-app-dropdown-trigger"
        >
            Create New Prompt
        </Button>
    )

    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger={["click"]}
            content={popoverContent}
            placement="bottomRight"
            arrow={false}
            styles={{container: {padding: 0}}}
        >
            <span className={className}>{trigger ?? defaultTrigger}</span>
        </Popover>
    )
}

export default memo(CreateAppDropdown)
