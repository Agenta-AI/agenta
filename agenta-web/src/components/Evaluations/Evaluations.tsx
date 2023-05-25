
import { useState, useEffect, useContext } from 'react';
import { Breadcrumb, Button, Col, Dropdown, Menu, Row, Spin, Switch } from 'antd';
import EvaluationTable from '../EvaluationTable/EvaluationTable';
import EvaluationTableWithChat from '../EvaluationTable/EvaluationTableWithChat';
import { DownOutlined } from '@ant-design/icons';
import AppContext from '@/contexts/appContext';
import { listVariants, loadDatasetsList } from '@/lib/services/api';
import { useRouter } from 'next/router';

export default function Evaluations() {
  const { app } = useContext(AppContext);
  const router = useRouter();
  const [areAppVariantsLoading, setAppVariantsLoading] = useState(false);
  const [appVariants, setAppVariants] = useState<any[]>([]);
  const [columnsCount, setColumnsCount] = useState(2);
  const [chatModeActivated, setChatModeActivated] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<{ _id?: string, name: string }>({ name: "Select a Dataset" });
  const [datasetContent, setDatasetContent] = useState<any[]>([]);
  const [datasetsList, setDatasetsList] = useState<any[]>([]);
  const [comparisonTableId, setComparisonTableId] = useState("");
  const [newEvaluationEnvironment, setNewEvaluationEnvironment] = useState(false);

  const { datasets, isDatasetsLoading, isDatasetsLoadingError } = loadDatasetsList();

  useEffect(() => {
    if (app == "") {
      router.push("/");
    }
  }, [app]);

  useEffect(() => {
    if (variants && Array.isArray(variants) && variants.length > 0) {
      const appVariantsFromResponse = variants.map((item: any, index: number) => ({
        id: index,
        name: item.variant_name,
        endpoint: item.variant_name
      }));
      setAppVariants(appVariantsFromResponse);
    }
  }, []);

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

  const { variants, isLoading, isError } = listVariants(app);
  if (isError) return <div>failed to load list of variants</div>
  if (isLoading) return <div>loading variants</div>

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
            <span style={{ marginRight: 10, fontWeight: 10 }}>Switch to Chat mode</span>
            <Switch defaultChecked={false} onChange={onSwitchToChatMode} />
          </div>
        </Col>
      </Row>

      {!chatModeActivated &&
        <EvaluationTable
          columnsCount={columnsCount}
          appVariants={appVariants}
          dataset={datasetContent}
          comparisonTableId={comparisonTableId}
        />}

      {chatModeActivated &&
        <EvaluationTableWithChat
          columnsCount={columnsCount}
          appVariants={appVariants}
        />}
    </div>
  );

}
