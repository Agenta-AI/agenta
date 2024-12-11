import {JSSTheme, LLMRunRateLimit} from "@/lib/Types"
import {QuestionCircleOutlined} from "@ant-design/icons"
import {CaretDown, SlidersHorizontal} from "@phosphor-icons/react"
import {Button, Col, Flex, Form, Input, InputNumber, Popover, Row, Tooltip, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"

interface AdvancedSettingsPopoverProps {
    setRateLimitValues: React.Dispatch<React.SetStateAction<LLMRunRateLimit>>
    rateLimitValues: LLMRunRateLimit
    setCorrectAnswerColumn: React.Dispatch<React.SetStateAction<string>>
    correctAnswerColumn: string
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading5,
        lineHeight: theme.lineHeightHeading5,
        fontWeight: theme.fontWeightMedium,
    },
    subTitle: {
        fontSize: theme.fontSize,
        lineHeight: theme.lineHeight,
        fontWeight: theme.fontWeightMedium,
    },
    container: {
        width: 400,
        "& .ant-popover-title": {
            marginBottom: theme.margin,
        },
        "& .ant-popover-inner": {
            padding: `${theme.paddingSM}px ${theme.padding}px`,
        },
    },
}))

const AdvancedSettingsPopover = ({
    setRateLimitValues,
    rateLimitValues,
    setCorrectAnswerColumn,
    correctAnswerColumn,
}: AdvancedSettingsPopoverProps) => {
    const classes = useStyles()

    const [openAdvancedConfigPopover, setOpenAdvancedConfigPopover] = useState(false)
    const [tempRateLimitValues, setTempRateLimitValues] = useState(rateLimitValues)
    const [tempCorrectAnswerColumn, setTempCorrectAnswerColumn] = useState(correctAnswerColumn)

    const handleSave = () => {
        setRateLimitValues(tempRateLimitValues)
        setCorrectAnswerColumn(tempCorrectAnswerColumn)
        setOpenAdvancedConfigPopover(false)
    }

    const handleCancel = () => {
        setTempRateLimitValues(rateLimitValues)
        setTempCorrectAnswerColumn(correctAnswerColumn)
        setOpenAdvancedConfigPopover(false)
    }

    const handleResetDefaults = () => {
        const defaultValues = {
            batch_size: 10,
            max_retries: 3,
            retry_delay: 3,
            delay_between_batches: 5,
        }
        setRateLimitValues(defaultValues)
        setTempRateLimitValues(defaultValues)
        setCorrectAnswerColumn("correct_answer")
        setTempCorrectAnswerColumn("correct_answer")
    }

    return (
        <Popover
            open={openAdvancedConfigPopover}
            onOpenChange={() => setOpenAdvancedConfigPopover(false)}
            trigger={["click"]}
            arrow={false}
            overlayClassName={classes.container}
            title={
                <Flex justify="space-between">
                    <Typography.Text className={classes.title}>Advanced settings</Typography.Text>
                    <Button onClick={handleResetDefaults}>Reset default</Button>
                </Flex>
            }
            content={
                <Flex vertical gap={8}>
                    <Form requiredMark={false} layout="vertical">
                        <Form.Item
                            required
                            label={
                                <Typography.Text className={classes.subTitle}>
                                    Rate Limit Configuration
                                </Typography.Text>
                            }
                            style={{marginBottom: 0}}
                        >
                            <Row gutter={16}>
                                {Object.entries(tempRateLimitValues).map(([key, value]) => (
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
                                                        return Promise.reject(
                                                            "This field is required",
                                                        )
                                                    },
                                                },
                                            ]}
                                        >
                                            <InputNumber
                                                value={value}
                                                onChange={(newValue) =>
                                                    newValue !== null &&
                                                    setTempRateLimitValues((prev) => ({
                                                        ...prev,
                                                        [key]: newValue,
                                                    }))
                                                }
                                                style={{width: "100%"}}
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
                                    <Tooltip title="Column in the test set containing the correct/expected answer">
                                        <QuestionCircleOutlined />
                                    </Tooltip>
                                </>
                            }
                        >
                            <Input
                                value={tempCorrectAnswerColumn}
                                onChange={(e) => setTempCorrectAnswerColumn(e.target.value)}
                                style={{width: "50%"}}
                            />
                        </Form.Item>
                    </Form>

                    <Flex justify="flex-end" gap={8}>
                        <Button onClick={handleCancel}>Cancel</Button>
                        <Button type="primary" onClick={handleSave}>
                            Save
                        </Button>
                    </Flex>
                </Flex>
            }
        >
            <Button
                onClick={() => setOpenAdvancedConfigPopover(true)}
                icon={<SlidersHorizontal size={14} />}
            >
                Advanced settings <CaretDown size={14} />
            </Button>
        </Popover>
    )
}

export default AdvancedSettingsPopover
