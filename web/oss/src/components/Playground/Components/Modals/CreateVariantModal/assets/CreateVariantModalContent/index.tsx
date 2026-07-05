import {type ChangeEvent, useCallback} from "react"

import {
    Combobox,
    ComboboxContent,
    ComboboxInput,
    ComboboxItem,
    ComboboxTrigger,
    ComboboxValue,
} from "@agenta/primitive-ui/components/combobox"
import {Input} from "@agenta/primitive-ui/components/input"
import {CommitMessageInput} from "@agenta/ui"
import {Form, Checkbox} from "antd"
import clsx from "clsx"

import {isVariantNameInputValid} from "@/oss/lib/helpers/utils"

import {CreateVariantModalContentProps} from "../types"

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
            const isValidFormat = isVariantNameInputValid(variantName)
            setIsInputValid(variantName.trim().length > 0 && !nameExists && isValidFormat)
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
                        <span>Base variant</span>
                        <Form.Item>
                            <Combobox
                                value={templateVariantName ?? ""}
                                onValueChange={handleTemplateVariantChange}
                            >
                                <ComboboxTrigger className="w-full">
                                    <ComboboxValue placeholder="Select a variant" />
                                </ComboboxTrigger>
                                <ComboboxContent>
                                    <ComboboxInput placeholder="Search variants..." />
                                    {variants?.map((variant) => (
                                        <ComboboxItem
                                            key={variant.variantName}
                                            value={variant.variantName}
                                        >
                                            {variant.variantName}
                                        </ComboboxItem>
                                    ))}
                                </ComboboxContent>
                            </Combobox>
                        </Form.Item>
                    </div>

                    <div className="flex flex-col gap-2">
                        <span>Variant name</span>
                        <Form.Item
                            validateStatus={
                                nameExists
                                    ? "error"
                                    : newVariantName.length > 0 &&
                                        !isVariantNameInputValid(newVariantName)
                                      ? "error"
                                      : newVariantName.length === 0
                                        ? "success"
                                        : "success"
                            }
                            help={
                                nameExists
                                    ? "Variant name already exists"
                                    : newVariantName.length > 0 &&
                                        !isVariantNameInputValid(newVariantName)
                                      ? "Variant name must contain only letters, numbers, underscore, or dash"
                                      : ""
                            }
                        >
                            <Input onChange={handleVariantNameChange} />
                        </Form.Item>
                    </div>

                    <CommitMessageInput value={note} onChange={setNote} />

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
