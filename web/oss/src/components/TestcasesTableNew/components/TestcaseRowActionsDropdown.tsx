import {useCallback, useMemo, useRef, useState, type MouseEvent} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {message} from "@agenta/ui/app-message"
import {Copy, DotsThreeVertical, ListChecks, PencilSimple, Trash} from "@phosphor-icons/react"
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

    const handleCopyIdClick = useCallback(() => {
        setDropdownOpen(false)
        void handleCopyId()
    }, [handleCopyId])

    const handleEditClick = useCallback(() => {
        setDropdownOpen(false)
        onEdit()
    }, [onEdit])

    const handleQueueClick = useCallback(() => {
        setDropdownOpen(false)
        requestAnimationFrame(() => {
            setQueuePopoverOpen(true)
        })
    }, [])

    const handleDeleteClick = useCallback(() => {
        setDropdownOpen(false)
        onDelete()
        message.success("Deleted testcase. Save to apply changes.")
    }, [onDelete])

    return (
        <AddToQueuePopover
            itemType="testcases"
            itemIds={queueItemIds}
            open={queuePopoverOpen}
            onOpenChange={setQueuePopoverOpen}
            toggleOnTriggerClick={false}
        >
            <DropdownMenu open={dropdownOpen} onOpenChange={handleDropdownOpenChange}>
                <DropdownMenuTrigger
                    className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit"
                    onClick={handleTriggerClick}
                >
                    <Button title="Actions" aria-label="Actions" variant="ghost" size="icon-sm">
                        <DotsThreeVertical size={16} weight="bold" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleEditClick}>
                        <PencilSimple size={16} />
                        Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={handleQueueClick}
                        disabled={queueItemIds.length === 0}
                    >
                        <ListChecks size={16} />
                        Add annotation queue
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={handleDeleteClick}>
                        <Trash size={16} />
                        Delete
                    </DropdownMenuItem>
                    {testcaseId && (
                        <DropdownMenuItem onClick={handleCopyIdClick}>
                            <Copy size={16} />
                            Copy ID
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </AddToQueuePopover>
    )
}

export default TestcaseRowActionsDropdown
