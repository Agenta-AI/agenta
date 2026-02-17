import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import DeleteVariantContent from "./Content"
import {DeleteVariantModalProps} from "./types"

type EnhancedProps = Omit<React.ComponentProps<typeof EnhancedModal>, "children">
type Props = EnhancedProps & DeleteVariantModalProps

const DeleteVariantModal = ({revisionIds, forceVariantIds, ...props}: Props) => {
    return (
        <EnhancedModal centered title="Are you sure you want to delete?" footer={null} {...props}>
            <DeleteVariantContent
                revisionIds={revisionIds}
                forceVariantIds={forceVariantIds}
                onClose={() => props.onCancel?.({} as any)}
            />
        </EnhancedModal>
    )
}

export default DeleteVariantModal
