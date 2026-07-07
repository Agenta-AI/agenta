/**
 * SectionDrawer
 *
 * Right-hand drawer chrome for a whole config SECTION (Model & harness, Advanced) — as opposed to
 * the per-item `ConfigItemDrawer`. The accordion header opens it; the body is whatever the host
 * passes as children. The host owns the draft model (snapshot the config on open, restore on
 * Cancel), so this is pure chrome: header (icon + title), a scrollable body, and Cancel/Save.
 *
 * Built on the shared `EnhancedDrawer`.
 */
import {type ReactNode, useCallback, useState} from "react"

import {EnhancedModal} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button} from "antd"

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
    footerNote?: ReactNode
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
    footerNote = "Draft — applies on save",
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
                // Explicit Cancel/Save only — an outside click must not silently keep an edit.
                closeOnLayoutClick={false}
                destroyOnClose
                title={
                    <div className="flex min-w-0 items-center gap-2">
                        {icon ? <span className="flex shrink-0 items-center">{icon}</span> : null}
                        <span className="truncate text-sm font-medium">{title}</span>
                    </div>
                }
                footer={
                    <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
                            {footerNote}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                            <Button onClick={onCancel}>Cancel</Button>
                            <Button type="primary" onClick={onSave} disabled={disabled}>
                                Save
                            </Button>
                        </div>
                    </div>
                }
                // The body itself doesn't scroll — the content (a full-height flex row) gives each
                // panel its own overflow, so the left and right panels scroll independently.
                styles={{body: {padding: 16, overflow: "hidden"}}}
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
                        <Button onClick={() => setConfirmOpen(false)}>Keep editing</Button>
                        <Button
                            danger
                            onClick={() => {
                                setConfirmOpen(false)
                                onCancel()
                            }}
                        >
                            Discard
                        </Button>
                        <Button
                            type="primary"
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
