import {EnhancedModal, ModalContent} from "@agenta/ui"
import {Typography} from "antd"

import {REGIONS, RegionId} from "@/oss/lib/helpers/region"

const {Paragraph} = Typography

interface RegionInfoModalProps {
    open: boolean
    onClose: () => void
}

const RegionInfoModal = ({open, onClose}: RegionInfoModalProps) => {
    return (
        <EnhancedModal title="Data Regions" open={open} onCancel={onClose} footer={null}>
            <ModalContent>
                <div className="flex flex-col gap-3 text-sm text-colorTextSecondary">
                    <Paragraph className="!m-0 text-colorTextSecondary">
                        Agenta Cloud is available in two regions:
                    </Paragraph>
                    <ul className="list-disc pl-5 text-colorTextSecondary">
                        {(Object.entries(REGIONS) as [RegionId, (typeof REGIONS)[RegionId]][]).map(
                            ([id, region]) => (
                                <li key={id}>
                                    {region.label}: {region.location}
                                </li>
                            ),
                        )}
                    </ul>
                    <Paragraph className="!m-0 text-colorTextSecondary">
                        Regions are completely isolated. No data is shared between regions. Choose a
                        region based on data residency requirements and latency needs.
                    </Paragraph>
                    <Paragraph className="!m-0 text-colorTextSecondary">
                        You can have accounts in multiple regions. Each requires a separate sign-up.
                    </Paragraph>
                </div>
            </ModalContent>
        </EnhancedModal>
    )
}

export default RegionInfoModal
