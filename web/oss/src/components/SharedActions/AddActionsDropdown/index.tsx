import {useCallback, useMemo, useRef, useState} from "react"

import {DatabaseIcon, ListChecks, ListPlus, PlusIcon} from "@phosphor-icons/react"
import {Button, Dropdown, type MenuProps} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import {AddActionsDropdownProps} from "./types"

const AddToQueuePopover = dynamic(
    () => import("@agenta/annotation-ui/add-to-queue").then((m) => m.default),
    {ssr: false},
)

/** Which queue action the (single) picker popover is serving. */
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
    // `null` = picker closed; otherwise which queue action opened it.
    const [queueScope, setQueueScope] = useState<QueueScope | null>(null)
    const suppressNextDropdownOpenRef = useRef(false)

    const actions = useMemo(
        () =>
            [
                testsetAction ? {disabled: testsetAction.disabled ?? false} : null,
                ...(additionalActions ?? []).map((action) => ({
                    disabled: action.disabled ?? false,
                })),
                queueAction ? {disabled: queueAction.disabled ?? false} : null,
                queueAllMatchingAction
                    ? {disabled: queueAllMatchingAction.disabled ?? false}
                    : null,
            ].filter(Boolean),
        [additionalActions, queueAction, queueAllMatchingAction, testsetAction],
    )

    const isButtonDisabled =
        disabled || actions.length === 0 || actions.every((action) => action?.disabled)

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

    const handleMenuClick = useCallback<NonNullable<MenuProps["onClick"]>>(
        ({key}) => {
            setDropdownOpen(false)

            if (key === "testset") {
                testsetAction?.onSelect()
                return
            }

            const selectedAction = additionalActions?.find((action) => action.key === key)
            if (selectedAction) {
                selectedAction.onSelect()
                return
            }

            if (key === "queue" && queueAction && !(queueAction.disabled ?? false)) {
                // rAF: let the dropdown finish closing before the popover opens.
                requestAnimationFrame(() => setQueueScope("selected"))
                return
            }

            if (
                key === "queue-all" &&
                queueAllMatchingAction &&
                !(queueAllMatchingAction.disabled ?? false)
            ) {
                const {onBeforeOpen} = queueAllMatchingAction
                // `onBeforeOpen` can gate the picker (e.g. a no-filter confirm).
                void (async () => {
                    const proceed = (await onBeforeOpen?.()) ?? true
                    if (proceed) {
                        requestAnimationFrame(() => setQueueScope("all-matching"))
                    }
                })()
            }
        },
        [additionalActions, queueAction, queueAllMatchingAction, testsetAction],
    )

    const menuItems = useMemo<NonNullable<MenuProps["items"]>>(() => {
        const items: NonNullable<MenuProps["items"]> = []

        if (testsetAction) {
            items.push({
                key: "testset",
                label: "Add to testset",
                icon: <DatabaseIcon size={14} />,
                disabled: testsetAction.disabled ?? false,
            })
        }

        additionalActions?.forEach((action) => {
            items.push({
                key: action.key,
                label: action.label,
                icon: action.icon,
                disabled: action.disabled ?? false,
            })
        })

        if (queueAction) {
            items.push({
                key: "queue",
                label: queueAction.label ?? "Add annotation queue",
                icon: <ListChecks size={14} />,
                disabled: queueAction.disabled ?? false,
            })
        }

        if (queueAllMatchingAction) {
            items.push({
                key: "queue-all",
                label: queueAllMatchingAction.label,
                icon: <ListPlus size={14} />,
                disabled: queueAllMatchingAction.disabled ?? false,
            })
        }

        return items
    }, [additionalActions, queueAction, queueAllMatchingAction, testsetAction])

    if (actions.length === 0) return null

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
        <Dropdown
            trigger={["click"]}
            open={dropdownOpen}
            onOpenChange={handleDropdownOpenChange}
            placement="bottomRight"
            menu={{items: menuItems, onClick: handleMenuClick}}
        >
            {button}
        </Dropdown>
    )

    const hasQueuePicker = Boolean(queueAction || queueAllMatchingAction)
    // When the picker is closed `queueScope` is null — fall back to whichever
    // action exists so the popover always has a coherent set of props.
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
