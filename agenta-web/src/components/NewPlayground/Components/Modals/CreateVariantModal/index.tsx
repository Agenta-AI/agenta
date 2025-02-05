import {type FC, type ChangeEvent, useState, useCallback} from "react"

import clsx from "clsx"

import {Modal, Input, Select, Typography, Form} from "antd"
import {CreateVariantModalProps} from "./types"

const {Text} = Typography

const CreateVariantModal: FC<CreateVariantModalProps> = ({
    isModalOpen,
    setIsModalOpen: propsSetIsModalOpen,
    addTab,
    variants,
    setNewVariantName,
    newVariantName,
    setTemplateVariantName,
}) => {
    const [variantPlaceHolder, setVariantPlaceHolder] = useState("Variant source")
    const [isInputValid, setIsInputValid] = useState(false)
    const [nameExists, setNameExists] = useState(false)

    const setIsModalOpen = useCallback(
        (value) => {
            if (!value) {
                setNewVariantName("")
                setTemplateVariantName("")
                setNameExists((oldValue) => false)
            }

            propsSetIsModalOpen(value)
        },
        [propsSetIsModalOpen, setNewVariantName, setTemplateVariantName],
    )

    const handleTemplateVariantChange = useCallback(
        (value: string) => {
            let newValue = value.includes(".") ? value.split(".")[0] : value
            setTemplateVariantName(value)
            setVariantPlaceHolder(`${newValue}`)
            setIsInputValid(newVariantName.trim().length > 0 && value !== "Variant source")
        },
        [newVariantName, setTemplateVariantName],
    )

    const handleVariantNameChange = useCallback(
        (e: ChangeEvent<HTMLInputElement>) => {
            const variantName = e.target.value
            setNewVariantName(variantName)
            const nameExists = variants.some((variant) => {
                const split = variant.variantName.split(".").slice(1).join(".")
                return split === variantName
            })

            setNameExists((oldValue) => nameExists)
            setIsInputValid(
                variantName.trim().length > 0 &&
                    variantPlaceHolder !== "Variant source" &&
                    !nameExists,
            )
        },
        [setNewVariantName, variantPlaceHolder, variants],
    )

    const onFinish = useCallback((values: any) => {
        return
    }, [])

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
            <Form onFinish={onFinish}>
                <section
                    className={clsx(["w-full flex flex-col gap-4", "[&_.ant-form-item]:mb-0"])}
                >
                    <div className="flex flex-col gap-2">
                        <Text>Base variant</Text>
                        <Form.Item>
                            <Select
                                showSearch
                                className="w-full"
                                data-cy="new-variant-modal-select"
                                placeholder="Select a variant"
                                onChange={handleTemplateVariantChange}
                                options={variants?.map((variant) => ({
                                    value: variant.variantName,
                                    label: (
                                        <div data-cy="new-variant-modal-label">
                                            {variant.variantName}
                                        </div>
                                    ),
                                }))}
                            />
                        </Form.Item>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Text>Variant name</Text>
                        <Form.Item
                            validateStatus={
                                nameExists
                                    ? "error"
                                    : newVariantName.length === 0 ||
                                        variantPlaceHolder === "Variant source"
                                      ? "success"
                                      : "success"
                            }
                            help={nameExists ? "Variant name already exists" : ""}
                        >
                            <Input
                                addonBefore={variantPlaceHolder}
                                onChange={handleVariantNameChange}
                                data-cy="new-variant-modal-input"
                            />
                        </Form.Item>
                    </div>
                </section>
            </Form>
        </Modal>
    )
}

export default CreateVariantModal
