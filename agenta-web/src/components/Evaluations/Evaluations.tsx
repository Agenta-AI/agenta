
import { useState, useEffect } from 'react';
import { Button, Col, Dropdown, Menu, Row, Switch } from 'antd';
import EvaluationTable from '../EvaluationTable/EvaluationTable';
import EvaluationTableWithChat from '../EvaluationTable/EvaluationTableWithChat';
import { DownOutlined } from '@ant-design/icons';
import { MenuInfo } from 'rc-menu/lib/interface';

import dataset from './dataset-startup-ideas.json';

export default function Evaluations() {

  const [areAppVariantsLoading, setAppVariantsLoading] = useState(false);
  const [appVariants, setAppVariants] = useState<any[]>([]);
  const [columnsCount, setColumnsCount] = useState(2);
  const [chatModeActivated, setChatModeActivated] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<string | []>("Select a Dataset");
  const [datasetContent, setDatasetContent] = useState<any[]>([]);

  useEffect(() => {
    onLoadAppVariants();
  }, []);

  const onLoadAppVariants = () => {
    setAppVariantsLoading(true);
    // setColumnsCount(3);

    fetch('http://localhost/api/app_variant/list/', {
      headers: {
        "Content-Type": "application/json",
      }
    })
      .then((res) => res.json())
      .then((data) => {

        const appVariantsFromResponse = data.map((item: any, index: number) => ({
          id: index,
          name: item.variant_name,
          endpoint: item.variant_name
        }));

        setAppVariants(appVariantsFromResponse);
        setAppVariantsLoading(false);
      });
  };

  const onSwitchToChatMode = (checked: boolean) => {
    setChatModeActivated(checked);
  };

  const handleDatasetMenuClick = (menuInfo: MenuInfo) => {
    setDatasetContent(dataset);
  };

  const dataSets = [
    {
      name: 'Dataset 1',
    },
    {
      name: 'Dataset 2',
    },
    {
      name: 'Dataset 3',
    }
  ]

  const menu = (
    <Menu onClick={(e) => handleDatasetMenuClick(e)}>
      {dataSets.map((dataSet, index) =>
        <Menu.Item key={dataSet.name}>
          {dataSet.name}
        </Menu.Item>
      )}
    </Menu>
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold pb-10">Evaluations</h1>

      <Row justify="space-between" style={{ marginTop: 20, marginBottom: 20 }}>
        <Col>
          <Dropdown overlay={menu} placement="bottomRight">
            <Button style={{ marginRight: 10 }}>
              {selectedDataset} <DownOutlined />
            </Button>
          </Dropdown>

          <Button onClick={onLoadAppVariants} style={{ marginRight: 10 }}>Refresh App Variants</Button>
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
        />}

      {chatModeActivated &&
        <EvaluationTableWithChat
          columnsCount={columnsCount}
          appVariants={appVariants}
        />}
    </div>
  );

}