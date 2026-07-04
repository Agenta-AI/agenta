import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@agenta/primitive-ui/components/alert-dialog"

import AvatarWithLabel from "../assets/AvatarWithLabel"

import {GenerateResetLinkModalProps} from "./assets/types"

const GenerateResetLinkModal = ({
    username,
    open,
    onClose,
    onConfirm,
}: GenerateResetLinkModalProps) => {
    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose()
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Are you sure you want to generate reset password link?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        You may only generate reset password link once per user.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex flex-col gap-1">
                    <span>You are about to generate reset password link for:</span>
                    <AvatarWithLabel name={username} />
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={() => {
                            onConfirm()
                            onClose()
                        }}
                    >
                        Generate Link
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export default GenerateResetLinkModal
