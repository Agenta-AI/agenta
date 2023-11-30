import {Row, Card, Slider, Select, InputNumber, Col, Input, Button} from "antd"
import React from "react"
import {Parameter, InputParameter} from "@/lib/Types"
import {renameVariables} from "@/lib/helpers/utils"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    row1: {
        padding: 0,
        width: "100%",
        marginTop: "16px",
    },
    card: {
        marginTop: 16,
        width: "100%",
        border: "1px solid #ccc",
        marginRight: "24px",
        "& .ant-card-body": {
            padding: "4px 16px",
            margin: "16px 0px",
            border: "0px solid #ccc",
        },
        "& .ant-card-head": {
            minHeight: 44,
            padding: "0px 12px",
        },
    },
    row2: {
        alignItems: "center",
        marginBottom: 10,
    },
    row2ObjParams: {
        alignItems: "center",
        marginTop: 12,
        marginBottom: 12,
    },
    deleteBtn: {
        margin: "0px 24px",
    },
    addBtn: {
        margin: "12px 0px",
    },
    textarea: {
        padding: 0,
    },
    colTitle: {
        margin: 0,
        padding: 0,
        textAlign: "left",
    },
    colSlider: {
        marginBottom: 8,
    },
    inputNumber: {
        margin: "0 16px",
        width: "100%",
    },
    select: {
        width: "100%",
    },
})

interface ModelParametersProps {
    optParams: Parameter[] | null
    onChange: (param: Parameter, value: number | string) => void
    handleParamChange: (name: string, value: number | string) => void
}

export const ModelParameters: React.FC<ModelParametersProps> = ({
    optParams,
    onChange,
    handleParamChange,
}) => {
    const classes = useStyles()
    return (
        <>
            {optParams?.some((param) => !param.input && param.type === "number") && (
                <Row gutter={0} className={classes.row1}>
                    <Card className={classes.card} title="Model Parameters">
                        {optParams
                            ?.filter(
                                (param) =>
                                    !param.input &&
                                    (param.type === "number" ||
                                        param.type === "integer" ||
                                        param.type === "array"),
                            )
                            .map((param, index) => (
                                <Row key={index} className={classes.row2}>
                                    <Col span={6}>
                                        <h4 className={classes.colTitle}>
                                            {renameVariables(param.name)}
                                        </h4>
                                    </Col>
                                    <Col span={8}>
                                        {param.type === "number" && (
                                            <Slider
                                                min={param.minimum}
                                                max={param.maximum}
                                                value={
                                                    typeof param.default === "number"
                                                        ? param.default
                                                        : 0
                                                }
                                                step={0.01}
                                                onChange={(value) => onChange(param, value)}
                                                className={classes.colSlider}
                                            />
                                        )}
                                        {param.type === "integer" && (
                                            <Slider
                                                min={param.minimum}
                                                max={param.maximum}
                                                value={
                                                    typeof param.default === "number"
                                                        ? param.default
                                                        : 1
                                                }
                                                step={1}
                                                onChange={(value) => onChange(param, value)}
                                                className={classes.colSlider}
                                            />
                                        )}
                                        {param.type === "array" && (
                                            <Select
                                                defaultValue={param.default}
                                                onChange={(value) =>
                                                    handleParamChange(param.name, value)
                                                }
                                                className={classes.select}
                                            >
                                                {param.enum?.map((value: string, index: number) => (
                                                    <Select.Option key={index} value={value}>
                                                        {value}
                                                    </Select.Option>
                                                ))}
                                            </Select>
                                        )}
                                    </Col>
                                    <Col>
                                        {param.type === "number" && (
                                            <InputNumber
                                                min={0}
                                                max={10000}
                                                className={classes.inputNumber}
                                                value={param.default}
                                                onChange={(value) => onChange(param, value)}
                                            />
                                        )}
                                        {param.type === "integer" && (
                                            <InputNumber
                                                min={param.minimum}
                                                max={param.maximum}
                                                className={classes.inputNumber}
                                                value={param.default}
                                                onChange={(value) => onChange(param, value)}
                                            />
                                        )}
                                    </Col>
                                    <Row />
                                </Row>
                            ))}
                    </Card>
                </Row>
            )}
        </>
    )
}

interface StringParametersProps {
    optParams: Parameter[] | null
    handleParamChange: (name: string, value: number | string) => void
}
export const StringParameters: React.FC<StringParametersProps> = ({
    optParams,
    handleParamChange,
}) => {
    const classes = useStyles()
    return (
        <>
            {optParams
                ?.filter((param) => param.type === "string" && !Array.isArray(param.default))
                .map((param, index) => (
                    <Row gutter={0} className={classes.row1} key={index}>
                        <Card className={classes.card} title={renameVariables(param.name)}>
                            <Input.TextArea
                                rows={5}
                                defaultValue={param.default}
                                onChange={(e) => handleParamChange(param.name, e.target.value)}
                                bordered={false}
                                className={classes.textarea}
                            />
                        </Card>
                    </Row>
                ))}
        </>
    )
}

interface ObjectParametersProps {
    optParams: Parameter[] | null
    handleParamChange: (name: string, value: any) => void
}

export const ObjectParameters: React.FC<ObjectParametersProps> = ({
    optParams,
    handleParamChange,
}) => {
    const classes = useStyles()

    const handleAddVariable = (param: Parameter) => {
        const updatedParams: InputParameter[] = [...param.default, {name: ""}]

        handleParamChange(param.name, updatedParams)
    }
    const handleVariableNameChange = (param: Parameter, variableIndex: number, newName: string) => {
        let updatedParams: InputParameter[] = [...param.default]
        updatedParams[variableIndex].name = newName
        handleParamChange(param.name, updatedParams)
    }
    const handleDeleteVariable = (param: Parameter, variableIndex: number) => {
        let updatedParams: InputParameter[] = [...param.default]
        updatedParams.splice(variableIndex, 1)
        handleParamChange(param.name, updatedParams)
    }
    return (
        <>
            {optParams
                ?.filter((param) => param.type === "object")
                .map((param, index) => (
                    <Row gutter={0} className={classes.row1} key={index}>
                        <Card className={classes.card} title={renameVariables(param.name)}>
                            {param.default.map((val: Parameter, index: number) => (
                                <Row key={index} className={classes.row2ObjParams}>
                                    <Col span={4}>
                                        <Input.TextArea
                                            rows={1}
                                            value={val.name}
                                            placeholder={"variable name"}
                                            maxLength={200}
                                            autoSize={false}
                                            size="small"
                                            onChange={(e) =>
                                                handleVariableNameChange(
                                                    param,
                                                    index,
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    </Col>
                                    <Col span={4}>
                                        <Button
                                            type="default"
                                            danger
                                            className={classes.deleteBtn}
                                            onClick={() => handleDeleteVariable(param, index)}
                                        >
                                            Delete
                                        </Button>
                                    </Col>
                                </Row>
                            ))}
                            <Button
                                type="default"
                                className={classes.addBtn}
                                onClick={() => handleAddVariable(param)}
                            >
                                + Add variable
                            </Button>
                        </Card>
                    </Row>
                ))}
        </>
    )
}
