// TODO: OLD FILE, CHECK IF IT CAN BE SHARED, AND IF IT NEEDS IMPROVEMENTS

import {type FC, type ChangeEvent, useState} from "react"
import {Modal, Input, Select, Typography} from "antd"
import {CreateVariantModalProps} from "./types"
import {useStyles} from "./styles"

const {Text} = Typography

const CreateVariantModal: FC<CreateVariantModalProps> = ({
    isModalOpen,
    setIsModalOpen,
    addTab,
    variants,
    setNewVariantName,
    newVariantName,
    setTemplateVariantName,
}) => {
    const classes = useStyles()
    const [variantPlaceHolder, setVariantPlaceHolder] = useState("Variant source")
    const [isInputValid, setIsInputValid] = useState(false)

    const handleTemplateVariantChange = (value: string) => {
        let newValue = value.includes(".") ? value.split(".")[0] : value
        setTemplateVariantName(value)
        setVariantPlaceHolder(`${newValue}`)
        setIsInputValid(newVariantName.trim().length > 0 && value !== "Variant source")
    }

    const handleVariantNameChange = (e: ChangeEvent<HTMLInputElement>) => {
        const variantName = e.target.value
        setNewVariantName(variantName)
        setIsInputValid(variantName.trim().length > 0 && variantPlaceHolder !== "Variant source")
    }

    return (
        <Modal
            data-cy="new-variant-modal"
            title="Create a new variant"
            open={isModalOpen}
            onOk={() => {
                if (isInputValid) {
                    setIsModalOpen(false)
                    addTab()
                }
            }}
            okText="Confirm"
            onCancel={() => setIsModalOpen(false)}
            okButtonProps={{disabled: !isInputValid}} // Disable OK button if input is not valid
            destroyOnClose
            centered
        >
            <section className="w-full flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <Text>Base variant</Text>
                    <Select
                        showSearch
                        className={classes.select}
                        data-cy="new-variant-modal-select"
                        placeholder="Select a variant"
                        onChange={handleTemplateVariantChange}
                        options={variants?.map((variant) => ({
                            value: variant.variantName,
                            label: (
                                <div data-cy="new-variant-modal-label">{variant.variantName}</div>
                            ),
                        }))}
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <Text>Variant name</Text>
                    <Input
                        addonBefore={variantPlaceHolder}
                        onChange={handleVariantNameChange}
                        data-cy="new-variant-modal-input"
                    />
                </div>
            </section>
        </Modal>
    )
}

export default CreateVariantModal
