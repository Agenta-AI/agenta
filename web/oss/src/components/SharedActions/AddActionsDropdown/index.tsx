import {useCallback, useMemo, useRef, useState} from "react"

import {DatabaseIcon, ListChecks, PlusIcon} from "@phosphor-icons/react"
import {Button, Dropdown, type MenuProps} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import {AddActionsDropdownProps} from "./types"

const AddToQueuePopover = dynamic(
    () => import("@agenta/annotation-ui/add-to-queue").then((m) => m.default),
    {ssr: false},
)

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
}: AddActionsDropdownProps) => {
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const [queuePopoverOpen, setQueuePopoverOpen] = useState(false)
    const suppressNextDropdownOpenRef = useRef(false)

    const actions = useMemo(
        () =>
            [
                testsetAction ? {disabled: testsetAction.disabled ?? false} : null,
                ...(additionalActions ?? []).map((action) => ({
                    disabled: action.disabled ?? false,
                })),
                queueAction ? {disabled: queueAction.disabled ?? false} : null,
            ].filter(Boolean),
        [additionalActions, queueAction, testsetAction],
    )

    const isButtonDisabled =
        disabled || actions.length === 0 || actions.every((action) => action?.disabled)

    const handleButtonClick = useCallback(() => {
        if (isButtonDisabled) return

        if (queuePopoverOpen) {
            suppressNextDropdownOpenRef.current = true
            setQueuePopoverOpen(false)
        }
    }, [isButtonDisabled, queuePopoverOpen])

    const handleDropdownOpenChange = useCallback((nextOpen: boolean) => {
        if (suppressNextDropdownOpenRef.current && nextOpen) {
            suppressNextDropdownOpenRef.current = false
            return
        }

        setDropdownOpen(nextOpen)
    }, [])

    const handleMenuClick = useCallback<MenuProps["onClick"]>(
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
                requestAnimationFrame(() => {
                    setQueuePopoverOpen(true)
                })
            }
        },
        [additionalActions, queueAction, testsetAction],
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
                label: "Add annotation queue",
                icon: <ListChecks size={14} />,
                disabled: queueAction.disabled ?? false,
            })
        }

        return items
    }, [additionalActions, queueAction, testsetAction])

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

    return (
        <div className={clsx("inline-flex", className)}>
            {queueAction ? (
                <AddToQueuePopover
                    itemType={queueAction.itemType}
                    itemIds={queueAction.itemIds}
                    disabled={isButtonDisabled}
                    onItemsAdded={queueAction.onItemsAdded}
                    open={queuePopoverOpen}
                    onOpenChange={setQueuePopoverOpen}
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
