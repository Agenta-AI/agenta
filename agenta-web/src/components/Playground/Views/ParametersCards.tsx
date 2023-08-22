import {Row, Card, Slider, Select, InputNumber, Col, Input, Button} from "antd"
import React, {ParamHTMLAttributes} from "react"
import {Parameter, InputParameter} from "@/lib/Types"
import {renameVariables} from "@/lib/helpers/utils"
import {useEffect} from "react"

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
    return (
        <>
            {optParams?.some((param) => !param.input && param.type === "number") && (
                <Row gutter={0} style={{padding: "0px 0px", width: "100%", marginTop: "16px"}}>
                    <Card
                        style={{
                            marginTop: 16,
                            width: "100%",
                            border: "1px solid #ccc",
                            marginRight: "24px",
                        }}
                        bodyStyle={{
                            padding: "4px 16px",
                            margin: "16px 0px",
                            border: "0px solid #ccc",
                        }}
                        headStyle={{minHeight: 44, padding: "0px 12px"}}
                        title="Model Parameters"
                    >
                        {optParams
                            ?.filter(
                                (param) =>
                                    !param.input &&
                                    (param.type === "number" ||
                                        param.type === "integer" ||
                                        param.type === "array"),
                            )
                            .map((param, index) => (
                                <Row
                                    key={index}
                                    style={{
                                        alignItems: "center",
                                        marginBottom: 10,
                                    }}
                                >
                                    <Col span={6}>
                                        <h4
                                            style={{
                                                margin: 0,
                                                padding: 0,
                                                textAlign: "left",
                                            }}
                                        >
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
                                                style={{marginBottom: 8}}
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
                                                style={{marginBottom: 8}}
                                            />
                                        )}
                                        {param.type === "array" && (
                                            <Select
                                                defaultValue={param.default}
                                                onChange={(value) =>
                                                    handleParamChange(param.name, value)
                                                }
                                                style={{width: "100%"}}
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
                                                style={{margin: "0 16px", width: "100%"}}
                                                value={param.default}
                                                onChange={(value) => onChange(param, value)}
                                            />
                                        )}
                                        {param.type === "integer" && (
                                            <InputNumber
                                                min={param.minimum}
                                                max={param.maximum}
                                                style={{margin: "0 16px", width: "100%"}}
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
    return (
        <>
            {optParams
                ?.filter((param) => param.type === "string")
                .map((param, index) => (
                    <Row
                        gutter={0}
                        style={{padding: "0px 0px", width: "100%", marginRight: "16px"}}
                        key={index}
                    >
                        <Card
                            style={{
                                marginTop: 16,
                                width: "100%",
                                border: "1px solid #ccc",
                                marginRight: "24px",
                            }}
                            bodyStyle={{padding: "4px 16px", border: "0px solid #ccc"}}
                            headStyle={{minHeight: 44, padding: "0px 12px"}}
                            title={renameVariables(param.name)}
                        >
                            <Input.TextArea
                                rows={5}
                                defaultValue={param.default}
                                onChange={(e) => handleParamChange(param.name, e.target.value)}
                                bordered={false}
                                style={{padding: "0px 0px"}}
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
                    <Row
                        gutter={0}
                        style={{padding: "0px 0px", width: "100%", marginRight: "16px"}}
                        key={index}
                    >
                        <Card
                            style={{
                                marginTop: 16,
                                width: "100%",
                                border: "1px solid #ccc",
                                marginRight: "24px",
                            }}
                            bodyStyle={{padding: "4px 16px", border: "0px solid #ccc"}}
                            headStyle={{minHeight: 44, padding: "0px 12px"}}
                            title={renameVariables(param.name)}
                        >
                            {param.default.map((val: Parameter, index: number) => (
                                <Row
                                    key={index}
                                    style={{
                                        alignItems: "center",
                                        marginTop: 12,
                                        marginBottom: 12,
                                    }}
                                >
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
                                            style={{margin: "0px 24px"}}
                                            onClick={() => handleDeleteVariable(param, index)}
                                        >
                                            Delete
                                        </Button>
                                    </Col>
                                </Row>
                            ))}
                            <Button
                                type="default"
                                style={{margin: "12px 0px"}}
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
