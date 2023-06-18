import { useState } from 'react';
import React from 'react';
import { Parameter } from '@/lib/Types';
import { Input, Slider, Row, Col, InputNumber, Button, Tooltip, message, Space, Card } from 'antd';

interface Props {
    variantName: string;            // The name of the variant
    optParams: Parameter[] | null;  // The optional parameters
    isParamSaveLoading: boolean;    // Whether the parameters are currently being saved
    onOptParamsChange: (newOptParams: Parameter[], persist: boolean, updateVariant: boolean) => void;
    handlePersistVariant: (variantName: string) => void;
    setRemovalVariantName: (variantName: string) => void;
    setRemovalWarningModalOpen: (value: boolean) => void;
    isDeleteLoading: boolean;
    isPersistent: boolean;
}

const ParametersView: React.FC<Props> = ({ variantName,
    optParams,
    isParamSaveLoading,
    onOptParamsChange,
    handlePersistVariant,
    setRemovalVariantName,
    setRemovalWarningModalOpen,
    isDeleteLoading,
    isPersistent }) => {

    const [inputValue, setInputValue] = useState(1);
    const [messageApi, contextHolder] = message.useMessage();
    const onChange = (param: Parameter, newValue: number) => {
        setInputValue(newValue);
        handleParamChange(param.name, newValue)
    };
    const handleParamChange = (name: string, newVal: any,) => {
        const newOptParams = optParams?.map(param =>
            param.name === name ? { ...param, default: newVal } : param);
        newOptParams && onOptParamsChange(newOptParams, false, false)
    }
    const success = () => {
        messageApi.open({
            type: 'success',
            content: 'Changes saved successfully!',
            onClose: () => handlePersistVariant(variantName,)
        });
    };

    return (
        <div >
            {contextHolder}

            {/* <Col span={12} style={{ padding: '0px 0px' }}> */}
            {optParams?.filter(param => (param.type === 'string')).map((param, index) => (
                <Row gutter={16} style={{ padding: '0px 0px', width: '100%' }} key={index}>
                    <Card
                        style={{ marginTop: 16, width: '100%', border: '1px solid #ccc' }}
                        bodyStyle={{ padding: '4px 16px', border: '0px solid #ccc' }}
                        headStyle={{ minHeight: 44, padding: '0px 12px' }}
                        title={param.name.charAt(0).toUpperCase() + param.name.slice(1).replace(/_/g, ' ')}

                    >
                        {/* <h3>{param.name}</h3> */}

                        <Input.TextArea rows={5}
                            defaultValue={param.default}
                            onChange={e => handleParamChange(param.name, e.target.value)}
                            bordered={false}
                            style={{ padding: '0px 0px' }}
                        />
                    </Card>
                </Row>
            ))}
            {/* </Col> */}

            {/* <Col span={12}> */}
            {optParams?.filter(param => (!param.input) && (param.type === 'number')).map((param, index) => (
                <Row gutter={16} style={{ padding: '0px 0px', width: '100%' }} key={index}>
                    <h3>{param.name}</h3>
                    <Row>
                        <Col span={12}>
                            <Slider
                                min={0}
                                max={1}
                                value={typeof param.default === 'number' ? param.default : 0}
                                step={0.01}
                                onChange={value => onChange(param, value)}
                                style={{ marginBottom: 16 }}
                            />
                        </Col>
                        <Col span={12}>
                            <InputNumber
                                min={1}
                                max={20}
                                style={{ margin: '0 16px' }}
                                value={param.default}
                                onChange={(value) => onChange(param, value)}
                            />
                        </Col>
                    </Row>

                </Row>
            ))}
            {/* </Col> */}



            <Row style={{ marginTop: 24 }}>
                <Col span={24} style={{ textAlign: 'left' }}>

                    <Space>
                        <Button
                            type="primary"
                            onClick={async () => {
                                console.log("Calling onOptParamsChange with optParams: ", optParams, " and isPersistent: ", true, " and isPersistent: ", isPersistent)
                                await onOptParamsChange(optParams!, true, isPersistent);
                                success();
                            }}
                            size='large'
                            loading={isParamSaveLoading}
                        >
                            <Tooltip placement="bottom" title="Save the new parameters for the variant permanently">
                                Save changes
                            </Tooltip>
                        </Button>
                        <Button
                            type="primary"
                            danger
                            size='large'
                            onClick={() => {
                                setRemovalVariantName(variantName);
                                setRemovalWarningModalOpen(true);
                            }}
                            loading={isDeleteLoading}
                        >
                            <Tooltip placement="bottom" title="Delete the variant permanently">
                                Delete Variant
                            </Tooltip>
                        </Button>

                    </Space>
                </Col >
            </Row >

        </div >
    );
};
export default ParametersView;