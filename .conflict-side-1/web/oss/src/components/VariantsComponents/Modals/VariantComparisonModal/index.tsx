import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import VariantComparisonContent from "./Content"

type VariantComparisonModalProps = Omit<React.ComponentProps<typeof EnhancedModal>, "children">

const VariantComparisonModal = ({...props}: VariantComparisonModalProps) => {
    return (
        <EnhancedModal
            footer={null}
            {...props}
            width="100%"
            style={{
                ...(props.style || {}),
                maxWidth: "calc(250px + 65ch)",
            }}
        >
            <VariantComparisonContent />
        </EnhancedModal>
    )
}

export default VariantComparisonModal
