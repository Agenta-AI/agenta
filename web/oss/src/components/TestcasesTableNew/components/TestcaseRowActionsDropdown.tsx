import {useCallback, useMemo, useRef, useState, type MouseEvent} from "react"

import {message} from "@agenta/ui/app-message"
import {MoreOutlined} from "@ant-design/icons"
import {Copy, ListChecks, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, type MenuProps} from "antd"
import dynamic from "next/dynamic"

import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"

const AddToQueuePopover = dynamic(
    () => import("@agenta/annotation-ui/add-to-queue").then((m) => m.default),
    {ssr: false},
)

interface TestcaseRowActionsDropdownProps {
    testcaseId: string | null
    onEdit: () => void
    onDelete: () => void
}

const TestcaseRowActionsDropdown = ({
    testcaseId,
    onEdit,
    onDelete,
}: TestcaseRowActionsDropdownProps) => {
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const [queuePopoverOpen, setQueuePopoverOpen] = useState(false)
    const suppressNextDropdownOpenRef = useRef(false)

    const queueItemIds = useMemo(
        () => (testcaseId && !testcaseId.startsWith("new-") ? [testcaseId] : []),
        [testcaseId],
    )

    const handleTriggerClick = useCallback(
        (event: MouseEvent<HTMLElement>) => {
            event.stopPropagation()

            if (queuePopoverOpen) {
                suppressNextDropdownOpenRef.current = true
                setQueuePopoverOpen(false)
            }
        },
        [queuePopoverOpen],
    )

    const handleDropdownOpenChange = useCallback((nextOpen: boolean) => {
        if (suppressNextDropdownOpenRef.current && nextOpen) {
            suppressNextDropdownOpenRef.current = false
            return
        }

        setDropdownOpen(nextOpen)
    }, [])

    const handleCopyId = useCallback(async () => {
        if (!testcaseId) return
        await copyToClipboard(testcaseId)
    }, [testcaseId])

    const handleMenuClick = useCallback<MenuProps["onClick"]>(
        ({key, domEvent}) => {
            domEvent.stopPropagation()
            setDropdownOpen(false)

            if (key === "edit") {
                onEdit()
                return
            }

            if (key === "queue" && queueItemIds.length > 0) {
                requestAnimationFrame(() => {
                    setQueuePopoverOpen(true)
                })
                return
            }

            if (key === "delete") {
                onDelete()
                message.success("Deleted testcase. Save to apply changes.")
                return
            }

            if (key === "copy-id") {
                void handleCopyId()
            }
        },
        [handleCopyId, onDelete, onEdit, queueItemIds.length],
    )

    const menuItems = useMemo<NonNullable<MenuProps["items"]>>(() => {
        const items: NonNullable<MenuProps["items"]> = [
            {
                key: "edit",
                label: "Edit",
                icon: <PencilSimple size={16} />,
            },
            {type: "divider"},
            {
                key: "queue",
                label: "Add annotation queue",
                icon: <ListChecks size={16} />,
                disabled: queueItemIds.length === 0,
            },
            {type: "divider"},
            {
                key: "delete",
                label: "Delete",
                icon: <Trash size={16} />,
                danger: true,
            },
        ]

        if (testcaseId) {
            items.push({type: "divider"})
            items.push({
                key: "copy-id",
                label: "Copy ID",
                icon: <Copy size={16} />,
            })
        }

        return items
    }, [queueItemIds.length, testcaseId])

    return (
        <AddToQueuePopover
            itemType="testcases"
            itemIds={queueItemIds}
            open={queuePopoverOpen}
            onOpenChange={setQueuePopoverOpen}
            toggleOnTriggerClick={false}
        >
            <Dropdown
                trigger={["click"]}
                open={dropdownOpen}
                onOpenChange={handleDropdownOpenChange}
                placement="bottomRight"
                menu={{items: menuItems, onClick: handleMenuClick}}
            >
                <Button
                    onClick={handleTriggerClick}
                    type="text"
                    icon={<MoreOutlined />}
                    size="small"
                    title="Actions"
                    aria-label="Actions"
                />
            </Dropdown>
        </AddToQueuePopover>
    )
}

export default TestcaseRowActionsDropdown
