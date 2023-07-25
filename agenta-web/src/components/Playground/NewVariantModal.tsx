// NewVariantModal.tsx

import React from "react"
import {Modal, Input, Select, Space, Typography} from "antd"
const {Text} = Typography

interface Props {
    isModalOpen: boolean
    setIsModalOpen: (value: boolean) => void
    addTab: () => void
    variants: any[]
    setNewVariantName: (value: string) => void
    setTemplateVariantName: (value: string) => void
}

const NewVariantModal: React.FC<Props> = ({
    isModalOpen,
    setIsModalOpen,
    addTab,
    variants,
    setNewVariantName,
    setTemplateVariantName,
}) => {
    return (
        <Modal
            title="Create a New Variant"
            open={isModalOpen}
            onOk={() => {
                setIsModalOpen(false)
                addTab()
            }}
            onCancel={() => setIsModalOpen(false)}
            centered
        >
            <Space direction="vertical" size={20}>
                <div>
                    <Text>Enter a unique name for the new variant:</Text>
                    <Input
                        placeholder="New variant name"
                        onChange={(e) => setNewVariantName(e.target.value)}
                    />
                </div>

                <div>
                    <Text>Select an existing variant to use as a template:</Text>
                    <Select
                        style={{width: "100%"}}
                        placeholder="Select a variant"
                        onChange={setTemplateVariantName}
                        options={variants.map((variant) => ({
                            value: variant.variantName,
                            label: variant.variantName,
                        }))}
                    />
                </div>
            </Space>
        </Modal>
    )
}

export default NewVariantModal
