
import { useState, useEffect } from 'react';
import { Button, Col, Divider, Dropdown, Menu, Row, Tag, message } from 'antd';
import EvaluationTableWithChat from '../EvaluationTable/EvaluationTableWithChat';
import { DownOutlined } from '@ant-design/icons';
import { fetchVariants, getVariantParameters, loadDatasetsList } from '@/lib/services/api';
import { useRouter } from 'next/router';
import { Variant, Parameter } from '@/lib/Types';
import EvaluationsList from './EvaluationsList';
import { EvaluationFlow } from '@/lib/enums';

export default function Evaluations() {
    const router = useRouter();
    const [areAppVariantsLoading, setAppVariantsLoading] = useState(false);
    const [isError, setIsError] = useState(false);
    const [variants, setVariants] = useState<any[]>([]);
    const [columnsCount, setColumnsCount] = useState(2);
    const [chatModeActivated, setChatModeActivated] = useState(false);
    const [selectedDataset, setSelectedDataset] = useState<{ _id?: string, name: string }>({ name: "Select a Dataset" });
    const [datasetsList, setDatasetsList] = useState<any[]>([]);

    const [selectedVariants, setSelectedVariants] = useState<Variant[]>(new Array(2).fill({ variantName: 'Select a variant' }));

    const app_name = router.query.app_name?.toString() || "";

    const { datasets, isDatasetsLoading, isDatasetsLoadingError } = loadDatasetsList(app_name);


    const [variantInputs, setVariantInputs] = useState<string[]>([]);

    useEffect(() => {
        if (variants.length > 0) {
            const fetchAndSetSchema = async () => {
                try {
                    const { inputParams } = await getVariantParameters(app_name, variants[0]);
                    setVariantInputs(inputParams.map((inputParam: Parameter) => inputParam.name));

                } catch (e) {
                    setIsError(true);
                }
            };
            fetchAndSetSchema();
        }
    }, [app_name, variants]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const backendVariants = await fetchVariants(app_name);

                if (backendVariants.length > 0) {
                    setVariants(backendVariants);
                }

                setAppVariantsLoading(false);
            } catch (error) {
                setIsError(true);
                setAppVariantsLoading(false);
            }
        };

        fetchData();
    }, [app_name]);

    if (isError) return <div>failed to load variants</div>
    if (areAppVariantsLoading) return <div>loading variants...</div>

    useEffect(() => {
        if (!isDatasetsLoadingError && datasets) {
            setDatasetsList(datasets);
        }
    }, [datasets, isDatasetsLoadingError]);

    // TODO: move to api.ts
    const createNewAppEvaluation = async (inputs: string[]) => {
        const postData = async (url = '', data = {}) => {
            const response = await fetch(url, {
                method: 'POST',
                cache: 'no-cache',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json'
                },
                redirect: 'follow',
                referrerPolicy: 'no-referrer',
                body: JSON.stringify(data)
            });

            return response.json();
        };

        const data = {
            variants: selectedVariants.map((variant) => variant.variantName), // TODO: Change to variant id
            app_name: app_name,
            inputs: inputs,
            dataset: {
                _id: selectedDataset._id,
                name: selectedDataset.name
            },
            status: EvaluationFlow.EVALUATION_FINISHED
        }

        return postData('http://localhost/api/app_evaluations/', data)
            .then(data => {
                return data.id;
            }).catch(err => {
                console.error(err);
            });
    };

    const onSwitchToChatMode = (checked: boolean) => {
        setChatModeActivated(checked);
    };

    const onDatasetSelect = (selectedDatasetIndexInDatasetsList: number) => {
        setSelectedDataset(datasetsList[selectedDatasetIndexInDatasetsList]);
    };

    const datasetsMenu = (
        <Menu>
            {datasetsList.map((dataset, index) =>
                <Menu.Item key={`${dataset.name}-${dataset._id}`} onClick={({ key }) => onDatasetSelect(index)}>
                    {dataset.name}
                </Menu.Item>
            )}
        </Menu>
    );

    const handleAppVariantsMenuClick = (dropdownIndex: number) => ({ key }: { key: string }) => {

        const data = {
            variants: [selectedVariants[dropdownIndex].variantName, selectedVariants[dropdownIndex].variantName]
        };

        data.variants[dropdownIndex] = key;
        const selectedVariant = variants.find(variant => variant.variantName === key);

        if (!selectedVariant) {
            console.log('Error: No variant found');
        }

        setSelectedVariants(prevState => {
            const newState = [...prevState];
            newState[dropdownIndex] = selectedVariant;
            return newState;
        });
    };

    const getVariantsDropdownMenu = (index: number) => (
        <Menu onClick={handleAppVariantsMenuClick(index)}>
            {variants.map((variant, index) =>
                <Menu.Item key={variant.variantName}>
                    {variant.variantName}
                </Menu.Item>
            )}
        </Menu>
    );

    const onStartEvaluation = async () => {
        // 1. We check all data is provided
        if (selectedDataset === undefined || selectedDataset.name === 'Select a Dataset') {
            message.error('Please select a dataset');
            return;
        } else if (selectedVariants[0].variantName === 'Select a variant' || selectedVariants[1].variantName === 'Select a variant') {
            message.error('Please select a variant for each column');
            return;
        }

        // 2. We create a new app evaluation
        const evaluationTableId = await createNewAppEvaluation(variantInputs);

        // 3 We set the variants
        setVariants(selectedVariants);

        router.push(`/apps/${app_name}/evaluations/${evaluationTableId}`);
    };

    return (
        <div>
            <Row justify="space-between" style={{ marginTop: 20, marginBottom: 40 }}>
                <Col>
                    <Dropdown
                        overlay={datasetsMenu}
                        // menu={{ items }}
                        placement="bottom"
                    >
                        <Button style={{ marginRight: 10, width: 180 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                {selectedDataset.name} <DownOutlined style={{ marginLeft: 'auto' }} />
                            </div>
                        </Button>
                    </Dropdown>

                    <Dropdown
                        overlay={getVariantsDropdownMenu(0)}
                        placement="bottom"
                    // className={selectedVariants[0].variantName == 'Select a variant' ? 'button-animation' : ''}
                    >
                        <Button style={{ marginRight: 10, width: 180 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                {selectedVariants[0].variantName}
                                <DownOutlined />
                            </div>
                        </Button>
                    </Dropdown>

                    <Dropdown
                        overlay={getVariantsDropdownMenu(1)}
                        placement="bottom"
                    // className={selectedVariants[0].variantName == 'Select a variant' ? 'button-animation' : ''}
                    >
                        <Button style={{ marginRight: 10, width: 180 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                {selectedVariants[1].variantName} <DownOutlined />
                            </div>
                        </Button>
                    </Dropdown>

                    <Button onClick={onStartEvaluation} type="primary">
                        Start a new evaluation
                    </Button>
                </Col>
                <Col>
                    <div>
                        <span style={{ marginRight: 10, fontWeight: 10, color: "grey" }}>Switch to Chat mode</span>
                        <Tag color="orange" bordered={false}>soon</Tag>
                        {/* <Switch defaultChecked={false} onChange={onSwitchToChatMode} disabled={true} /> */}
                    </div>
                </Col>
            </Row>

            <Divider />

            <EvaluationsList />

            {/* {chatModeActivated &&
        <EvaluationTableWithChat
          columnsCount={columnsCount}
          appVariants={appVariants}
        />} */}
        </div>
    );

}