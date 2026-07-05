import {useCallback, useMemo, useRef, useState, type ReactNode} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {DatabaseIcon, ListChecks, PlusIcon} from "@phosphor-icons/react"
import clsx from "clsx"
import dynamic from "next/dynamic"

import {AddActionsDropdownAction, AddActionsDropdownProps} from "./types"

const AddToQueuePopover = dynamic(
    () => import("@agenta/annotation-ui/add-to-queue").then((m) => m.default),
    {ssr: false},
)

type QueueScope = "selected" | "all-matching"

const AddActionsDropdown = ({
    size = "middle",
    disabled = false,
    className,
    buttonClassName,
    buttonType = "default",
    dataTour,
    testsetAction,
    additionalActions,
    queueAction,
    queueAllMatchingAction,
}: AddActionsDropdownProps) => {
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const [queueScope, setQueueScope] = useState<QueueScope | null>(null)
    const suppressNextDropdownOpenRef = useRef(false)

    const hasAnyAction =
        testsetAction ||
        (additionalActions && additionalActions.length > 0) ||
        queueAction ||
        queueAllMatchingAction

    const isButtonDisabled =
        disabled ||
        !hasAnyAction ||
        (testsetAction?.disabled &&
            (!additionalActions || additionalActions.every((a) => a.disabled)) &&
            queueAction?.disabled &&
            queueAllMatchingAction?.disabled)

    const handleButtonClick = useCallback(() => {
        if (isButtonDisabled) return

        if (queueScope !== null) {
            suppressNextDropdownOpenRef.current = true
            setQueueScope(null)
        }
    }, [isButtonDisabled, queueScope])

    const handleDropdownOpenChange = useCallback((nextOpen: boolean) => {
        if (suppressNextDropdownOpenRef.current && nextOpen) {
            suppressNextDropdownOpenRef.current = false
            return
        }

        setDropdownOpen(nextOpen)
    }, [])

    const handleTestsetClick = useCallback(() => {
        setDropdownOpen(false)
        testsetAction?.onSelect()
    }, [testsetAction])

    const handleActionClick = useCallback((action: AddActionsDropdownAction) => {
        setDropdownOpen(false)
        action.onSelect()
    }, [])

    const handleQueueClick = useCallback(() => {
        setDropdownOpen(false)
        if (queueAction && !(queueAction.disabled ?? false)) {
            requestAnimationFrame(() => setQueueScope("selected"))
        }
    }, [queueAction])

    const handleQueueAllClick = useCallback(() => {
        setDropdownOpen(false)
        if (queueAllMatchingAction && !(queueAllMatchingAction.disabled ?? false)) {
            const {onBeforeOpen} = queueAllMatchingAction
            void (async () => {
                const proceed = (await onBeforeOpen?.()) ?? true
                if (proceed) {
                    requestAnimationFrame(() => setQueueScope("all-matching"))
                }
            })()
        }
    }, [queueAllMatchingAction])

    const menuItems = useMemo<ReactNode[]>(() => {
        const items: ReactNode[] = []

        if (testsetAction) {
            items.push(
                <DropdownMenuItem
                    key="testset"
                    disabled={testsetAction.disabled}
                    onClick={handleTestsetClick}
                >
                    <DatabaseIcon size={16} />
                    Create testset
                </DropdownMenuItem>,
            )
        }

        if (additionalActions) {
            for (const action of additionalActions) {
                items.push(
                    <DropdownMenuItem
                        key={action.key}
                        disabled={action.disabled}
                        onClick={() => handleActionClick(action)}
                    >
                        {action.icon}
                        {action.label}
                    </DropdownMenuItem>,
                )
            }
        }

        if (queueAction) {
            items.push(
                <DropdownMenuItem
                    key="queue"
                    disabled={queueAction.disabled}
                    onClick={handleQueueClick}
                >
                    <ListChecks size={16} />
                    {queueAction.label ?? "Add annotation queue"}
                </DropdownMenuItem>,
            )
        }

        if (queueAllMatchingAction) {
            items.push(
                <DropdownMenuItem
                    key="queue-all"
                    disabled={queueAllMatchingAction.disabled}
                    onClick={handleQueueAllClick}
                >
                    <ListChecks size={16} />
                    {queueAllMatchingAction.label}
                </DropdownMenuItem>,
            )
        }

        return items
    }, [
        testsetAction,
        additionalActions,
        queueAction,
        queueAllMatchingAction,
        handleTestsetClick,
        handleActionClick,
        handleQueueClick,
        handleQueueAllClick,
    ])

    if (!hasAnyAction) return null

    const button = (
        <Button
            type={buttonType}
            size={size}
            className={clsx(buttonClassName)}
            icon={<PlusIcon size={14} />}
            disabled={isButtonDisabled}
            aria-label="Add"
            data-tour={dataTour}
            onClick={handleButtonClick}
        >
            Add
        </Button>
    )

    const dropdown = (
        <DropdownMenu open={dropdownOpen} onOpenChange={handleDropdownOpenChange}>
            <DropdownMenuTrigger
                className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit"
                onClick={(e) => e.stopPropagation()}
            >
                {button}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">{menuItems}</DropdownMenuContent>
        </DropdownMenu>
    )

    const hasQueuePicker = Boolean(queueAction || queueAllMatchingAction)
    const effectiveScope: QueueScope = queueScope ?? (queueAction ? "selected" : "all-matching")
    const isAllMatching = effectiveScope === "all-matching"

    return (
        <div className={clsx("inline-flex", className)}>
            {hasQueuePicker ? (
                <AddToQueuePopover
                    itemType={isAllMatching ? "traces" : (queueAction?.itemType ?? "traces")}
                    itemIds={isAllMatching ? undefined : (queueAction?.itemIds ?? [])}
                    onItemsAdded={isAllMatching ? undefined : queueAction?.onItemsAdded}
                    onQueueSelected={
                        isAllMatching ? queueAllMatchingAction?.onQueueSelected : undefined
                    }
                    disabled={isButtonDisabled}
                    open={queueScope !== null}
                    onOpenChange={(nextOpen) => {
                        if (!nextOpen) setQueueScope(null)
                    }}
                    toggleOnTriggerClick={false}
                >
                    {dropdown}
                </AddToQueuePopover>
            ) : (
                dropdown
            )}
        </div>
    )
}

export default AddActionsDropdown
