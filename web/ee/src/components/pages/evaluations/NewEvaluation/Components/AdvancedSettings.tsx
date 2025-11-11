import {memo, useCallback, useMemo} from "react"

import {QuestionCircleOutlined} from "@ant-design/icons"
import {Button, Col, Flex, Form, Input, InputNumber, Row, Tooltip, Typography} from "antd"
import deepEqual from "fast-deep-equal"

import {DEFAULT_ADVANCE_SETTINGS} from "../assets/constants"
import {AdvancedSettingsProps} from "../types"

const AdvancedSettings = ({advanceSettings, setAdvanceSettings}: AdvancedSettingsProps) => {
    const handleChange = (key: string, value: any) => {
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

    const {correct_answer_column, ...rateLimitConfig} = advanceSettings

    return (
        <Flex vertical gap={8}>
            <Form requiredMark={false} layout="vertical">
                <Form.Item
                    required
                    label={
                        <div className="w-full flex items-center gap-2 h-10">
                            <Typography.Text className="text-md font-medium">
                                Rate Limit Configuration
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
                    <Row gutter={16}>
                        {Object.entries(rateLimitConfig).map(([key, value]) => (
                            <Col span={12} key={key}>
                                <Form.Item
                                    label={
                                        <>
                                            {key
                                                .replace(/_/g, " ")
                                                .replace(/\b\w/g, (c) => c.toUpperCase())}
                                            &nbsp;
                                            <Tooltip title={`Description for ${key}`}>
                                                <QuestionCircleOutlined />
                                            </Tooltip>
                                        </>
                                    }
                                    rules={[
                                        {
                                            validator: (_, value) => {
                                                if (value !== null) {
                                                    return Promise.resolve()
                                                }
                                                return Promise.reject("This field is required")
                                            },
                                        },
                                    ]}
                                >
                                    <InputNumber
                                        value={advanceSettings[key as keyof typeof advanceSettings]}
                                        onChange={(value) => handleChange(key, value)}
                                        style={{width: "100%"}}
                                        min={0}
                                    />
                                </Form.Item>
                            </Col>
                        ))}
                    </Row>
                </Form.Item>
                <Form.Item
                    required
                    label={
                        <>
                            Correct Answer Column&nbsp;
                            <Tooltip title="Column in the testset containing the correct/expected answer">
                                <QuestionCircleOutlined />
                            </Tooltip>
                        </>
                    }
                >
                    <Input
                        value={advanceSettings.correct_answer_column}
                        onChange={(e) => handleChange("correct_answer_column", e.target.value)}
                        style={{width: "50%"}}
                    />
                </Form.Item>
            </Form>
        </Flex>
    )
}

export default memo(AdvancedSettings)
