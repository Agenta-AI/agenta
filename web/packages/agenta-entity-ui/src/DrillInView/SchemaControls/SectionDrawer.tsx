/**
 * SectionDrawer
 *
 * Right-hand drawer chrome for a whole config SECTION (Model & harness, Advanced) — as opposed to
 * the per-item `ConfigItemDrawer`. The accordion header opens it; the body is whatever the host
 * passes as children. The host owns the draft model (snapshot the config on open, restore on
 * Cancel), so this is pure chrome: header (title), a scrollable body, and Cancel/Save.
 *
 * Built on the shared `EnhancedDrawer`.
 */
import {type ReactNode, useCallback, useState} from "react"

import {EnhancedModal} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button} from "@agenta/ui/ui"

export interface SectionDrawerProps {
    open: boolean
    title: ReactNode
    icon?: ReactNode
    onCancel: () => void
    onSave: () => void
    disabled?: boolean
    // When true, closing via scrim/X asks for confirmation instead of discarding silently.
    dirty?: boolean
    width?: number
    children: ReactNode
}

export function SectionDrawer({
    open,
    title,
    icon,
    onCancel,
    onSave,
    disabled = false,
    dirty = false,
    width = 720,
    children,
}: SectionDrawerProps) {
    const [confirmOpen, setConfirmOpen] = useState(false)
    // Scrim/X close: guard with a confirm when dirty; the footer Cancel button bypasses this.
    const handleRequestClose = useCallback(() => {
        if (dirty) {
            setConfirmOpen(true)
        } else {
            onCancel()
        }
    }, [dirty, onCancel])
    return (
        <>
            <EnhancedDrawer
                rootClassName="ag-drawer-elevated"
                open={open}
                onClose={handleRequestClose}
                placement="right"
                width={width}
                destroyOnClose
                title={
                    <div className="flex min-w-0 items-center gap-2">
                        {icon ? <span className="flex shrink-0 items-center">{icon}</span> : null}
                        <span className="truncate text-sm font-medium">{title}</span>
                    </div>
                }
                footer={
                    <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" onClick={onCancel}>
                            Cancel
                        </Button>
                        <Button onClick={onSave} disabled={disabled}>
                            Save
                        </Button>
                    </div>
                }
                // The body itself doesn't scroll — the content (a full-height flex row) gives each
                // panel its own overflow, so the left and right panels scroll independently.
                // Tighter side inset than top/bottom: the rail sits right against the left edge,
                // and 16px there read as a gutter. The vertical 16 is what the rail's `bleed`
                // negates, so it stays put.
                styles={{body: {padding: "16px 12px", overflow: "hidden"}}}
            >
                {children}
            </EnhancedDrawer>
            <EnhancedModal
                open={confirmOpen}
                onCancel={() => setConfirmOpen(false)}
                title="You have unsaved changes"
                width={420}
                footer={
                    <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                            Keep editing
                        </Button>
                        <Button
                            variant="destructive-outline"
                            onClick={() => {
                                setConfirmOpen(false)
                                onCancel()
                            }}
                        >
                            Discard
                        </Button>
                        <Button
                            disabled={disabled}
                            onClick={() => {
                                setConfirmOpen(false)
                                onSave()
                            }}
                        >
                            Save changes
                        </Button>
                    </div>
                }
            >
                <p className="text-sm">Save your changes to this agent draft, or discard them?</p>
            </EnhancedModal>
        </>
    )
}
