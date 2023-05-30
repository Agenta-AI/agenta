
import { useState, useEffect } from 'react';
import { Button, Col, Dropdown, Menu, Row, Spin, Switch, Tooltip, Tag, message, MenuProps } from 'antd';
import EvaluationTable from './../EvaluationTable/EvaluationTable';
import EvaluationTableWithChat from '../EvaluationTable/EvaluationTableWithChat';
import { DownOutlined } from '@ant-design/icons';
import { fetchVariants, loadDatasetsList } from '@/lib/services/api';
import { useRouter } from 'next/router';
import { Variant } from '@/lib/Types';
import EmptyEvaluationTable from '../EvaluationTable/EmptyEvaluationTable';

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

  const { datasets, isDatasetsLoading, isDatasetsLoadingError } = loadDatasetsList();

  const app_name = router.query.app_name?.toString() || "";

  const [evaluationTable, setEvaluationTable] = useState(EmptyEvaluationTable);

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

  const createNewAppEvaluation = async () => {
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

    return postData('http://localhost/api/app_evaluations/')
      .then(data => {
        return data.id;
      }).catch(err => {
        console.error(err);
      });
  };

  const onSwitchToChatMode = (checked: boolean) => {
    setChatModeActivated(checked);
  };

  const loadDataset = async () => {
    return fetch(`http://localhost/api/datasets/${selectedDataset._id}`, {
      headers: {
        "Content-Type": "application/json",
      }
    })
      .then((res) => res.json())
      .then((data) => {
        return data.csvdata
      })
      .catch((err) => {
        console.error(err);
      });
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
    const evaluationTableId = await createNewAppEvaluation();

    // 3. We load the selected dataset
    const datasetContent = await loadDataset();
    setVariants(selectedVariants)

    // 4. We create the evaluation table
    setEvaluationTable(<EvaluationTable
      columnsCount={columnsCount}
      variants={variants}
      dataset={datasetContent}
      comparisonTableId={evaluationTableId}
    />);
    // 5. We reset everything
    setSelectedVariants(new Array(2).fill({ variantName: 'Select a variant' }));
    setSelectedDataset({ name: 'Select a Dataset' });
    setColumnsCount(2);
  };

  return (
    <div>
      <Row justify="space-between" style={{ marginTop: 20, marginBottom: 20 }}>
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
            Start Evaluating
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

      {!chatModeActivated &&
        evaluationTable
      }

      {/* {chatModeActivated &&
        <EvaluationTableWithChat
          columnsCount={columnsCount}
          appVariants={appVariants}
        />} */}
    </div>
  );

}