
import { useState, useEffect } from 'react';
import { Button, Col, Dropdown, Menu, Row, Spin, Switch, Tooltip, Tag, message } from 'antd';
import EvaluationTable from './../EvaluationTable/EvaluationTable';
import EvaluationTableWithChat from '../EvaluationTable/EvaluationTableWithChat';
import { DownOutlined } from '@ant-design/icons';
import { fetchVariants, loadDatasetsList } from '@/lib/services/api';
import { useRouter } from 'next/router';

export default function Evaluations() {
  const router = useRouter();
  const [areAppVariantsLoading, setAppVariantsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [variants, setVariants] = useState<any[]>([]);
  const [columnsCount, setColumnsCount] = useState(2);
  const [chatModeActivated, setChatModeActivated] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<{ _id?: string, name: string }>({ name: "Select a Dataset" });
  const [datasetContent, setDatasetContent] = useState<any[]>([]);
  const [datasetsList, setDatasetsList] = useState<any[]>([]);
  const [comparisonTableId, setComparisonTableId] = useState("");
  const [newEvaluationEnvironment, setNewEvaluationEnvironment] = useState(false);

  const { datasets, isDatasetsLoading, isDatasetsLoadingError } = loadDatasetsList();

  const app_name = router.query.app_name?.toString() || "";

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

  useEffect(() => {
    if (newEvaluationEnvironment) {
      setupNewEvaluationEnvironment();
      setNewEvaluationEnvironment(false);
    }
  }, [newEvaluationEnvironment]);

  const createNewEvaluationEnvironment = () => {
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

    postData('http://localhost/api/app_evaluations/')
      .then(data => {
        setComparisonTableId(data.id);
      }).catch(err => {
        console.error(err);
      });
  };

  const onSwitchToChatMode = (checked: boolean) => {
    setChatModeActivated(checked);
  };

  const setupNewEvaluationEnvironment = () => {
    createNewEvaluationEnvironment();
    loadDataset()
  };

  const loadDataset = () => {
    fetch(`http://localhost/api/datasets/${selectedDataset._id}`, {
      headers: {
        "Content-Type": "application/json",
      }
    })
      .then((res) => res.json())
      .then((data) => {
        setDatasetContent(data.csvdata);
      });
  };

  const updateData = (newData: object[]) => {
    setDatasetContent(newData);
  };

  const onDatasetSelect = (selectedDatasetIndexInDatasetsList: number) => {
    setSelectedDataset(datasetsList[selectedDatasetIndexInDatasetsList]);
    setNewEvaluationEnvironment(true)
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

  return (
    <div>
      <Row justify="space-between" style={{ marginTop: 20, marginBottom: 20 }}>
        <Col>
          <Dropdown overlay={datasetsMenu} placement="bottomRight">
            <Button style={{ marginRight: 10 }}>
              {selectedDataset.name} <DownOutlined />
            </Button>
          </Dropdown>

          {/* <Button onClick={onLoadAppVariants} style={{ marginRight: 10 }}>Refresh App Variants</Button> */}
        </Col>
        <Col>
          <div>

            <span style={{ marginRight: 10, fontWeight: 10, color: "grey" }}>Switch to Chat mode</span>
            <Tag color="orange" bordered={false}>soon</Tag>
            {/* <Switch defaultChecked={false} onChange={onSwitchToChatMode} disabled={true} /> */}
          </div>
        </Col>
      </Row>

      {!chatModeActivated && datasetContent.length > 0 &&
        <EvaluationTable
          columnsCount={columnsCount}
          variants={variants}
          dataset={datasetContent}
          comparisonTableId={comparisonTableId}
        />}

      {/* {chatModeActivated &&
        <EvaluationTableWithChat
          columnsCount={columnsCount}
          appVariants={appVariants}
        />} */}
    </div>
  );

}