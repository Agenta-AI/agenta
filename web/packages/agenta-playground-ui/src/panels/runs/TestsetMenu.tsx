import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {
    ArrowsLeftRight,
    CaretDown,
    Database,
    Link,
    ListBullets,
    Plus,
    XCircle,
} from "@phosphor-icons/react"

import type {TestsetMenuModel} from "../../hooks/useTestsetMenuModel"

export interface TestsetMenuProps {
    model: TestsetMenuModel
    /** Opens "Add to test set". The item stays hidden without it. */
    onAddToTestset?: () => void
}

/**
 * The test set button of the run pane. Not connected, it connects a test set; connected, it syncs,
 * manages, changes or disconnects it. It opens no dialog itself: the model says which one is open.
 */
export const TestsetMenu = ({model, onAddToTestset}: TestsetMenuProps) => {
    if (!model.visible) return null
    const addToTestset = onAddToTestset ? (
        <DropdownMenuItem disabled={!model.hasSuccessfulResults} onSelect={onAddToTestset}>
            <Plus aria-hidden size={14} />
            Add to test set
        </DropdownMenuItem>
    ) : null

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="max-w-40">
                    <Database aria-hidden size={14} />
                    <span className="truncate">{model.label}</span>
                    <CaretDown aria-hidden size={12} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
                {model.isConnected ? (
                    <>
                        <DropdownMenuItem disabled={!model.hasLocalChanges} onSelect={model.sync}>
                            <Database aria-hidden size={14} />
                            Sync changes
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={model.manage}>
                            <ListBullets aria-hidden size={14} />
                            Manage test cases
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={model.change}>
                            <ArrowsLeftRight aria-hidden size={14} />
                            Change test set
                        </DropdownMenuItem>
                        {addToTestset}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={model.disconnect}>
                            <XCircle aria-hidden size={14} />
                            Disconnect
                        </DropdownMenuItem>
                    </>
                ) : (
                    <>
                        <DropdownMenuItem onSelect={model.connect}>
                            <Link aria-hidden size={14} />
                            Connect test set
                        </DropdownMenuItem>
                        {addToTestset ? (
                            <>
                                <DropdownMenuSeparator />
                                {addToTestset}
                            </>
                        ) : null}
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
