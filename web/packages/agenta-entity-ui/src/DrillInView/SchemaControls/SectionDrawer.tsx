/**
 * SectionDrawer
 *
 * Right-hand drawer chrome for a whole config SECTION (Model & harness, Advanced) — as opposed to
 * the per-item `ConfigItemDrawer`. The accordion header opens it; the body is whatever the host
 * passes as children. The host owns the draft model (snapshot the config on open, restore on
 * Cancel), so this is pure chrome: header (title), a scrollable body, and Cancel/Save.
 *
 * Built on the kit `Sheet`.
 */
import {type ReactNode, useCallback, useState} from "react"

import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Sheet,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@agenta/ui/ui"

import {DeferredBody, FormDrawerSkeleton} from "./DrawerSkeletons"
import {SectionDrawerPanelContext} from "./sectionDrawerPanel"

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
    /** Body padding; a rail body passes a flush top so it starts right under the header. */
    bodyPadding?: string
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
    bodyPadding = "16px 12px",
    children,
}: SectionDrawerProps) {
    const t = useT(configItemsCatalog)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [panel, setPanel] = useState<HTMLDivElement | null>(null)
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
            <Sheet
                open={open}
                onOpenChange={(next) => {
                    if (!next) handleRequestClose()
                }}
            >
                <SheetContent
                    ref={setPanel}
                    side="right"
                    className="ag-drawer-elevated"
                    // The panel floats 8px in from each edge, so the clamp leaves room for both.
                    style={{width, maxWidth: "calc(100% - 1rem)"}}
                >
                    <SheetHeader>
                        <SheetTitle className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                                {icon ? (
                                    <span className="flex shrink-0 items-center">{icon}</span>
                                ) : null}
                                <span className="truncate text-label font-medium">{title}</span>
                            </div>
                        </SheetTitle>
                    </SheetHeader>
                    {/* The body itself doesn't scroll — the content (a full-height flex row) gives
                        each panel its own overflow, so the left and right panels scroll
                        independently. */}
                    <div
                        className="min-h-0 flex-1 overflow-hidden text-field-md text-foreground"
                        style={{padding: bodyPadding}}
                    >
                        <DeferredBody fallback={<FormDrawerSkeleton />}>
                            <SectionDrawerPanelContext.Provider value={panel}>
                                {children}
                            </SectionDrawerPanelContext.Provider>
                        </DeferredBody>
                    </div>
                    <SheetFooter>
                        <div className="flex items-center justify-end gap-2">
                            <Button variant="outline" onClick={onCancel}>
                                {t("entityUi.configItems.cancel")}
                            </Button>
                            <Button onClick={onSave} disabled={disabled}>
                                {t("entityUi.configItems.save")}
                            </Button>
                        </div>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
            <Dialog
                open={confirmOpen}
                onOpenChange={(next) => {
                    if (!next) setConfirmOpen(false)
                }}
            >
                <DialogContent className="max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle>{t("entityUi.configItems.unsavedChanges")}</DialogTitle>
                    </DialogHeader>
                    <p className="text-body">{t("entityUi.configItems.saveOrDiscardDraft")}</p>
                    <DialogFooter>
                        <div className="flex items-center justify-end gap-2">
                            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                                {t("entityUi.configItems.keepEditing")}
                            </Button>
                            <Button
                                variant="destructive-ghost"
                                onClick={() => {
                                    setConfirmOpen(false)
                                    onCancel()
                                }}
                            >
                                {t("entityUi.configItems.discard")}
                            </Button>
                            <Button
                                disabled={disabled}
                                onClick={() => {
                                    setConfirmOpen(false)
                                    onSave()
                                }}
                            >
                                {t("entityUi.configItems.saveChanges")}
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
