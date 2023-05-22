import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { RocketOutlined, FileTextOutlined, DatabaseOutlined, CloudUploadOutlined, BarChartOutlined, LineChartOutlined, MonitorOutlined, UserOutlined, QuestionOutlined } from '@ant-design/icons';
import { Avatar, Badge, Card, Layout, Menu, Space, Tag, Tooltip, theme, } from 'antd';
import { MenuInfo } from 'rc-menu/lib/interface';

import Logo from '../Header/Logo';

const { Sider } = Layout;

const Sidebar: React.FC = () => {
  const router = useRouter();

  const navigate = (path: string) => {
    router.push(path);
  };
  const {
    token: { colorBgContainer },
  } = theme.useToken();


  const [selectedKeys, setSelectedKeys] = React.useState(["1"]);

  const handleClick = (e: MenuInfo) => {
    setSelectedKeys([e.key]);
  };

  return (
    <Sider theme='light' style={{ paddingLeft: '10px', paddingRight: '10px', background: colorBgContainer }} width={250}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ marginTop: '30px', marginBottom: '20px', display: 'flex', justifyContent: 'center' }}>
          <Logo />
        </div>
        <Menu defaultSelectedKeys={['1']} mode="inline" onClick={handleClick}
          selectedKeys={selectedKeys} style={{ borderRight: 0 }}>

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


                <Space>
                  <span>
                    VectorDB
                  </span>
                  <span>
                    <Tag color="warning">soon</Tag>
                  </span>
                </Space>
              </div>
            </Tooltip>

          </Menu.Item>

          <Menu.Item key="6" icon={<CloudUploadOutlined />} onClick={() => navigate('/deployements')} disabled={true}>
            <Tooltip placement="right" title="Transition the optimal variant into the production environment.">
              <div style={{ width: '100%' }}>
                <Space>
                  <span>
                    Deployment
                  </span>
                  <span>
                    <Tag color="warning">soon</Tag>
                  </span>
                </Space>
              </div>
            </Tooltip>
          </Menu.Item>

          <Menu.Item key="7" icon={<MonitorOutlined />} onClick={() => navigate('/logs')} disabled={true}>
            <Tooltip placement="right" title="Monitor production logs to ensure seamless operations.">
              <div style={{ width: '100%' }}>
                <Space>
                  <span>
                    Monitoring
                  </span>
                  <span>
                    <Tag color="warning">soon</Tag>
                  </span>
                </Space>
              </div>
            </Tooltip>

          </Menu.Item>
        </Menu>

        <div style={{ flex: 1 }} />

        <Menu mode="vertical" style={{ paddingBottom: 40, borderRight: 0 }} onClick={handleClick}
          selectedKeys={selectedKeys}>
          <Menu.Item key="8" icon={<QuestionOutlined />}>
            Help
          </Menu.Item>
          <Menu.Item key="9">
            <Space>
              <Avatar size="small" style={{ backgroundColor: '#87d068' }} icon={<UserOutlined />} />
              <span>Foulen</span>
            </Space>

          </Menu.Item>
        </Menu>
      </div>
    </Sider>
  );
};

export default Sidebar;
