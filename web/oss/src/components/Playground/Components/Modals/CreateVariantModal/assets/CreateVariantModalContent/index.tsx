import {type ChangeEvent, useCallback} from "react"

import {Input, Select, Typography, Form, Checkbox} from "antd"
import clsx from "clsx"

import CommitNote from "@/oss/components/Playground/assets/CommitNote"

import {CreateVariantModalContentProps} from "../types"

const {Text} = Typography

const CreateVariantModalContent = ({
    setTemplateVariantName,
    templateVariantName,
    setIsInputValid,
    newVariantName,
    setNewVariantName,
    setNameExists,
    variants,
    nameExists,
    note,
    setNote,
    setIsCompareMode,
    isCompareMode,
}: CreateVariantModalContentProps) => {
    const handleTemplateVariantChange = useCallback(
        (value: string) => {
            setTemplateVariantName(value)
            setIsInputValid(!!newVariantName)
        },
        [newVariantName, setTemplateVariantName],
    )

    const handleVariantNameChange = useCallback(
        (e: ChangeEvent<HTMLInputElement>) => {
            const variantName = e.target.value
            setNewVariantName(variantName)
            const nameExists = variants.some((variant) => {
                const split = variant.variantName
                return split === variantName
            })

            setNameExists((oldValue) => nameExists)
            setIsInputValid(variantName.trim().length > 0 && !nameExists)
        },
        [setNewVariantName, variants],
    )

    const onFinish = useCallback((values: any) => {
        return
    }, [])

    return (
        <>
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
                                placeholder="Select a variant"
                                value={templateVariantName}
                                onChange={handleTemplateVariantChange}
                                options={variants?.map((variant) => ({
                                    value: variant.variantName,
                                    label: <div>{variant.variantName}</div>,
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
                                    : newVariantName.length === 0
                                      ? "success"
                                      : "success"
                            }
                            help={nameExists ? "Variant name already exists" : ""}
                        >
                            <Input onChange={handleVariantNameChange} />
                        </Form.Item>
                    </div>

                    <CommitNote note={note} setNote={setNote} />

                    <Checkbox
                        checked={isCompareMode}
                        onChange={(e) => setIsCompareMode(e.target.checked)}
                    >
                        Open in compare mode
                    </Checkbox>
                </section>
            </Form>
        </>
    )
}

export default CreateVariantModalContent
