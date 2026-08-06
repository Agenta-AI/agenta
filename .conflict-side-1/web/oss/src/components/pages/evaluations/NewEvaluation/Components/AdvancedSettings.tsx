import {memo, useCallback, useMemo} from "react"

import {QuestionCircleOutlined} from "@ant-design/icons"
import {Button, Flex, Form, InputNumber, Tooltip, Typography} from "antd"
import deepEqual from "fast-deep-equal"

import {DEFAULT_ADVANCE_SETTINGS} from "../assets/constants"
import {AdvancedSettingsProps, EvaluationConcurrencySettings} from "../types"

const FIELD_LABELS: Record<keyof EvaluationConcurrencySettings, string> = {
    batch_size: "Batch Size",
    max_retries: "Max Retries",
    retry_delay: "Retry Delay (s)",
}

const FIELD_TOOLTIPS: Record<keyof EvaluationConcurrencySettings, string> = {
    batch_size: "Maximum number of concurrent invocations",
    max_retries: "How many times to retry a failed invocation",
    retry_delay: "Seconds to wait before retrying a failed invocation",
}

const AdvancedSettings = ({advanceSettings, setAdvanceSettings}: AdvancedSettingsProps) => {
    const handleChange = (key: keyof EvaluationConcurrencySettings, value: number | null) => {
        setAdvanceSettings((prev) => ({
            ...prev,
            [key]: value,
        }))
    }

    const handleResetDefaults = useCallback(() => {
        setAdvanceSettings(DEFAULT_ADVANCE_SETTINGS)
    }, [])

    const isAdvancedSettingsChanged = useMemo(
        () => !deepEqual(advanceSettings, DEFAULT_ADVANCE_SETTINGS),
        [advanceSettings],
    )

    return (
        <Flex vertical gap={8}>
            <Form requiredMark={false} layout="vertical">
                <Form.Item
                    label={
                        <div className="w-full flex items-center gap-2 h-10">
                            <Typography.Text className="text-md font-medium">
                                Concurrency
                            </Typography.Text>
                            {isAdvancedSettingsChanged && (
                                <Button
                                    danger
                                    className="w-fit"
                                    size="small"
                                    onClick={handleResetDefaults}
                                >
                                    Reset changes
                                </Button>
                            )}
                        </div>
                    }
                    style={{marginBottom: 0}}
                >
                    {(
                        Object.keys(
                            DEFAULT_ADVANCE_SETTINGS,
                        ) as (keyof EvaluationConcurrencySettings)[]
                    ).map((key) => (
                        <Form.Item
                            key={key}
                            label={
                                <>
                                    {FIELD_LABELS[key]}&nbsp;
                                    <Tooltip title={FIELD_TOOLTIPS[key]}>
                                        <QuestionCircleOutlined />
                                    </Tooltip>
                                </>
                            }
                            rules={[
                                {
                                    validator: (_, value) =>
                                        value !== null
                                            ? Promise.resolve()
                                            : Promise.reject("This field is required"),
                                },
                            ]}
                        >
                            <InputNumber
                                value={advanceSettings[key]}
                                onChange={(value) => handleChange(key, value)}
                                style={{width: "100%"}}
                                min={0}
                            />
                        </Form.Item>
                    ))}
                </Form.Item>
            </Form>
        </Flex>
    )
}

export default memo(AdvancedSettings)
