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
    <Sider width={180} style={{ paddingTop: '40px', paddingLeft: '30px', paddingRight: '10px', background: colorBgContainer }}>

      <Menu
        mode="inline"
        defaultSelectedKeys={['1']}
        defaultOpenKeys={['sub1']}
        style={{ borderRight: 0 }}
      >
        <Tooltip placement="right" title="Experiment with real data and optimize your parameters including prompts, methods, and configuration settings.">
          <Menu.Item key="1" icon={<RocketOutlined />} onClick={() => navigate('/playground')}>
            Playground
          </Menu.Item>
        </Tooltip>
        <Tooltip placement="right" title="Create and manage datasets for evaluation purposes.">
          <Menu.Item key="2" icon={<DatabaseOutlined />} onClick={() => navigate('/datasets')}>
            Datasets
          </Menu.Item>
        </Tooltip>

        <Tooltip placement="right" title="Perform 1-to-1 variant comparisons on datasets to identify superior options.">
          <Menu.Item key="3" icon={<LineChartOutlined />} onClick={() => navigate('/evaluations')}>
            Evaluate
          </Menu.Item>
        </Tooltip>
        <Tooltip placement="right" title="Analyze the evaluation outcomes to determine the most effective variants.">
          <Menu.Item key="4" icon={<BarChartOutlined />} onClick={() => navigate('/results')}>
            Results
          </Menu.Item>
        </Tooltip>
        <Tooltip placement="right" title="Establish VectorDB Knowledge Bases and upload pertinent documents.">
          <Menu.Item key="5" icon={<FileTextOutlined />} onClick={() => navigate('/vectordb')} disabled={true}>
            VectorDB
          </Menu.Item>
        </Tooltip>

        <Tooltip placement="right" title="Transition the optimal variant into the production environment.">
          <Menu.Item key="6" icon={<CloudUploadOutlined />} onClick={() => navigate('/deployements')} disabled={true}>
            Deployment
          </Menu.Item>
        </Tooltip>
        <Tooltip placement="right" title="Monitor production logs to ensure seamless operations.">
          <Menu.Item key="7" icon={<MonitorOutlined />} onClick={() => navigate('/logs')} disabled={true}>
            Monitoring
          </Menu.Item>
        </Tooltip>

      </Menu>
    </Sider >
  );
};

export default Sidebar;
