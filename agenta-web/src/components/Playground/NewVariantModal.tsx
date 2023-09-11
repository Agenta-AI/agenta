// NewVariantModal.tsx

import React, {useState} from "react"
import {Modal, Input, Select, Space, Typography} from "antd"
import {createUseStyles} from "react-jss"
const {Text} = Typography

interface Props {
    isModalOpen: boolean
    setIsModalOpen: (value: boolean) => void
    addTab: () => void
    variants: any[]
    setNewVariantName: (value: string) => void
    newVariantName: string
    setTemplateVariantName: (value: string) => void
}

const useStyles = createUseStyles({
    select: {
        width: "100%",
    },
})

const NewVariantModal: React.FC<Props> = ({
    isModalOpen,
    setIsModalOpen,
    addTab,
    variants,
    setNewVariantName,
    newVariantName,
    setTemplateVariantName,
}) => {
    const classes = useStyles()
    const [variantPlaceHolder, setVariantPlaceHolder] = useState("Source Variant")
    const [isInputValid, setIsInputValid] = useState(false)

    const handleTemplateVariantChange = (value: string) => {
        let newValue = value.includes(".") ? value.split(".")[0] : value
        setTemplateVariantName(value)
        setVariantPlaceHolder(`${newValue}`)
        setIsInputValid(newVariantName.trim().length > 0 && value !== "Source Variant")
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputValue = e.target.value
        setNewVariantName(inputValue)
        setIsInputValid(inputValue.trim().length > 0 && variantPlaceHolder !== "Source Variant")
    }

    return (
        <Modal
            title="Create a New Variant"
            open={isModalOpen}
            onOk={() => {
                if (isInputValid) {
                    setIsModalOpen(false)
                    addTab()
                }
            }}
            onCancel={() => setIsModalOpen(false)}
            centered
            okButtonProps={{disabled: !isInputValid}} // Disable OK button if input is not valid
        >
            <Space direction="vertical" size={20}>
                <div>
                    <Text>Select an existing variant to use as a template:</Text>
                    <Select
                        className={classes.select}
                        placeholder="Select a variant"
                        onChange={handleTemplateVariantChange}
                        options={variants.map((variant) => ({
                            value: variant.variantName,
                            label: variant.variantName,
                        }))}
                    />
                </div>

                <div>
                    <Text>Enter a unique name for the new variant:</Text>
                    <Input addonBefore={variantPlaceHolder} onChange={handleInputChange} />
                </div>
            </Space>
        </Modal>
    )
}

export default NewVariantModal
