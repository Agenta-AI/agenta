import {DeleteProviderModalContentProps} from "./types"

const DeleteProviderModalContent = ({selectedProvider}: DeleteProviderModalContentProps) => {
    return (
        <div className="flex flex-col gap-4">
            <span>This action is not reversible.</span>

            <div className="flex flex-col gap-1">
                <span>You are about to delete:</span>
                <span className="text-sm font-medium">
                    {selectedProvider?.title || selectedProvider?.name} API Key
                </span>
            </div>
        </div>
    )
}

export default DeleteProviderModalContent
