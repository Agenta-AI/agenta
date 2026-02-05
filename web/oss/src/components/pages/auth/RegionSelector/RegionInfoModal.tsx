import {Modal, Typography} from "antd"

const {Paragraph} = Typography

interface RegionInfoModalProps {
    open: boolean
    onClose: () => void
}

const RegionInfoModal = ({open, onClose}: RegionInfoModalProps) => {
    return (
        <Modal title="Data Regions" open={open} onCancel={onClose} footer={null}>
            <div className="flex flex-col gap-3 text-sm text-[#586673]">
                <Paragraph className="!m-0 text-[#586673]">
                    Agenta Cloud is available in two regions:
                </Paragraph>
                <ul className="list-disc pl-5 text-[#586673]">
                    <li>EU: Frankfurt, Germany</li>
                    <li>US: Ohio, United States</li>
                </ul>
                <Paragraph className="!m-0 text-[#586673]">
                    Regions are completely isolated. No data is shared between regions. Choose a
                    region based on data residency requirements and latency needs.
                </Paragraph>
                <Paragraph className="!m-0 text-[#586673]">
                    You can have accounts in multiple regions. Each requires a separate sign-up.
                </Paragraph>
            </div>
        </Modal>
    )
}

export default RegionInfoModal
