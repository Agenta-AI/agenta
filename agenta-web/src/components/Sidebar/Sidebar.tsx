import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { MailOutlined, AppstoreOutlined, RocketOutlined, FileTextOutlined, DatabaseOutlined, CloudUploadOutlined, BarChartOutlined, LineChartOutlined, MonitorOutlined } from '@ant-design/icons';
import { Layout, Menu, Tooltip, theme } from 'antd';

const { Sider } = Layout;

const Sidebar: React.FC = () => {
  const router = useRouter();

  const navigate = (path: string) => {
    router.push(path);
  };
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  return (
    <Sider width={180} style={{ paddingTop: '40px', paddingLeft: '10px', paddingRight: '10px', background: colorBgContainer }}>

      <Menu
        mode="inline"
        defaultSelectedKeys={['1']}
        style={{ borderRight: 0 }}
      >
        <Menu.Item key="1" icon={<RocketOutlined />} onClick={() => navigate('/playground')}>
          <Tooltip placement="right" title="Experiment with real data and optimize your parameters including prompts, methods, and configuration settings.">
            <div style={{ width: '100%' }}>
              Playground
            </div>
          </Tooltip>

        </Menu.Item>
        <Menu.Item key="2" icon={<DatabaseOutlined />} onClick={() => navigate('/datasets')}>
          <Tooltip placement="right" title="Create and manage datasets for evaluation purposes.">
            <div style={{ width: '100%' }}>

              Datasets
            </div>
          </Tooltip>

        </Menu.Item>
        <Menu.Item key="3" icon={<LineChartOutlined />} onClick={() => navigate('/evaluations')}>

          <Tooltip placement="right" title="Perform 1-to-1 variant comparisons on datasets to identify superior options.">
            <div style={{ width: '100%' }}>

              Evaluate
            </div>

          </Tooltip>

        </Menu.Item>
        <Menu.Item key="4" icon={<BarChartOutlined />} onClick={() => navigate('/results')}>
          <Tooltip placement="right" title="Analyze the evaluation outcomes to determine the most effective variants.">
            <div style={{ width: '100%' }}>

              Results
            </div>
          </Tooltip>

        </Menu.Item>
        <Menu.Item key="5" icon={<FileTextOutlined />} onClick={() => navigate('/vectordb')} disabled={true}>
          <Tooltip placement="right" title="Establish VectorDB Knowledge Bases and upload pertinent documents.">
            <div style={{ width: '100%' }}>

              VectorDB
            </div>
          </Tooltip>

        </Menu.Item>

        <Menu.Item key="6" icon={<CloudUploadOutlined />} onClick={() => navigate('/deployements')} disabled={true}>
          <Tooltip placement="right" title="Transition the optimal variant into the production environment.">
            <div style={{ width: '100%' }}>
            </div>

            Deployment
          </Tooltip>
        </Menu.Item>

        <Menu.Item key="7" icon={<MonitorOutlined />} onClick={() => navigate('/logs')} disabled={true}>
          <Tooltip placement="right" title="Monitor production logs to ensure seamless operations.">
            <div style={{ width: '100%' }}>
              Monitoring
            </div>
          </Tooltip>

        </Menu.Item>

      </Menu>
    </Sider >
  );
};

export default Sidebar;
