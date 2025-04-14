import {Typography} from "antd"

import {DeleteProviderModalContentProps} from "./types"

const {Text} = Typography

const DeleteProviderModalContent = ({selectedProvider}: DeleteProviderModalContentProps) => {
    return (
        <div className="flex flex-col gap-4">
            <Text>This action is not reversible.</Text>

            <div className="flex flex-col gap-1">
                <Text>You are about to delete:</Text>
                <Text className="text-sm font-medium">
                    {selectedProvider?.title || selectedProvider?.name} API Key
                </Text>
            </div>
        </div>
    )
}

export default DeleteProviderModalContent
