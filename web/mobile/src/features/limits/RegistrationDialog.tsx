import {useProfile} from "@agenta/entities/profile"
import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@agenta/ui/ui"

import {RegistrationForm} from "../settings/RegistrationForm"
import {RegistrationGains} from "../settings/RegistrationGains"

/** The free key registration over the place that needed it, such as a create dialog. */
export const RegistrationDialog = ({
    open,
    title,
    projectId,
    onClose,
}: {
    open: boolean
    title: string
    projectId: string
    onClose: () => void
}) => {
    const {user} = useProfile()
    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent aria-describedby={undefined}>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <RegistrationGains />
                <RegistrationForm projectId={projectId} defaultEmail={user?.email} />
            </DialogContent>
        </Dialog>
    )
}
