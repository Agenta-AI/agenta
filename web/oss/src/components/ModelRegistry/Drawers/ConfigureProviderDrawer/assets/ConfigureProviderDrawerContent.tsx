import {useEffect, useMemo, useState} from "react"
import SelectLLMProvider from "@/oss/components/SelectLLMProvider"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {Plus, WarningCircle} from "@phosphor-icons/react"
import {Button, Form, Typography} from "antd"
import LabelInput from "../../../assets/LabelInput"
import {PROVIDER_FIELDS} from "./constants"
import ModelNameInput from "./ModelNameInput"
import {ConfigureProviderDrawerContentProps} from "./types"
import {useWatch} from "antd/lib/form/Form"
import {isAppNameInputValid} from "@/oss/lib/helpers/utils"
import {SecretDTOProvider} from "@/oss/lib/Types"

const {Text} = Typography

const ConfigureProviderDrawerContent = ({
    form,
    onClose,
    selectedProvider,
}: ConfigureProviderDrawerContentProps) => {
    const [errorMessage, setErrorMessage] = useState("")
    const {handleModifyCustomVaultSecret} = useVaultSecret()

    const standardProviders = useMemo(() => [...Object.values(SecretDTOProvider)], [])
    const customProviders = useMemo(() => ["azure", "bedrock", "custom"], [])
    const validProviders = useMemo(
        () => [...customProviders, ...standardProviders],
        [standardProviders, customProviders],
    )
    const providerValue = useWatch("provider", form)?.toLowerCase() || ""
    const shouldFilter = validProviders.includes(providerValue)

    useEffect(() => {
        if (selectedProvider) {
            form.setFieldsValue(selectedProvider)
        } else {
            form.resetFields()
        }
    }, [selectedProvider])

    const onSubmit = async (values: LlmProvider) => {
        try {
            if (form.getFieldValue("models").length === 0 || !form.getFieldValue("models")[0]) {
                setErrorMessage("Please add a model name before submitting")
                return
            }

            if (selectedProvider?.id) {
                await handleModifyCustomVaultSecret({...values, id: selectedProvider?.id})
            } else {
                await handleModifyCustomVaultSecret(values)
            }

            onClose()
        } catch (error: any) {
            if (error.status === 422) {
                setErrorMessage(error.response.data.detail[0].msg)
            } else {
                setErrorMessage("Something went wrong! Please try again with the right credential.")
            }
        }
    }

    return (
        <Form
            form={form}
            layout="vertical"
            onFinish={onSubmit}
            initialValues={{
                provider: "",
                name: "",
                apiKey: "",
                apiBaseUrl: "",
                accessKeyId: "",
                accessKey: "",
                sessionToken: "",
                models: [""],
            }}
        >
            <section className="[&_>.ant-form-item]:!mb-0 flex flex-col gap-4">
                {errorMessage && (
                    <Typography.Text className="mb-1 flex items-center gap-1" type="danger">
                        <WarningCircle size={16} /> {errorMessage.replace("Value error,", "")}
                    </Typography.Text>
                )}

                <div className="flex flex-col gap-1">
                    <Text className="font-medium">Provider</Text>
                    <Form.Item name="provider" className="mb-0" rules={[{required: true}]}>
                        <SelectLLMProvider />
                    </Form.Item>
                </div>

                {PROVIDER_FIELDS.filter((field) => {
                    if (shouldFilter) {
                        return !field.model || field.model.includes(providerValue)
                    }

                    return true
                }).map((field) => (
                    <>
                        <Form.Item
                            key={field.key}
                            name={field.key}
                            rules={[
                                {
                                    required:
                                        standardProviders.includes(providerValue) &&
                                        field.key === "apiBaseUrl"
                                            ? false
                                            : !shouldFilter
                                              ? field.required
                                              : true,
                                    ...(field.key === "name"
                                        ? {
                                              validator(_, value, callback) {
                                                  if (!value) {
                                                      callback("Please enter name")
                                                  } else if (!isAppNameInputValid(value)) {
                                                      callback(
                                                          "Name must contain only letters, numbers, underscore, or dash without any spaces.",
                                                      )
                                                  } else {
                                                      callback()
                                                  }
                                              },
                                          }
                                        : {}),
                                },
                            ]}
                        >
                            <LabelInput label={field.label} placeholder={field.placeholder} />
                        </Form.Item>
                        {field.note && <Text className="text-[#586673] -mt-2">{field.note}</Text>}
                    </>
                ))}

                <Form.List name="models">
                    {(fields, {add, remove}) => (
                        <div className="flex flex-col gap-2">
                            <div className="w-full flex items-center justify-between">
                                <Text className="font-medium">Models</Text>
                                <Button
                                    icon={<Plus size={14} />}
                                    size="small"
                                    onClick={() => add()}
                                >
                                    Add
                                </Button>
                            </div>
                            {fields.length === 0 ? (
                                <Text className="text-[#586673]">No custom models configured</Text>
                            ) : (
                                fields.map((field) => {
                                    const {key, ...restField} = field
                                    return (
                                        <Form.Item
                                            key={key}
                                            {...restField}
                                            rules={[
                                                {
                                                    required: true,
                                                    message: "Please add a model name",
                                                    min: 1,
                                                },
                                            ]}
                                            className="mb-0"
                                        >
                                            <ModelNameInput onDelete={() => remove(field.name)} />
                                        </Form.Item>
                                    )
                                })
                            )}
                        </div>
                    )}
                </Form.List>
            </section>
        </Form>
    )
}

export default ConfigureProviderDrawerContent
