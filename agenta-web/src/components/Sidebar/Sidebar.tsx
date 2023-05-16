import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { MailOutlined, AppstoreOutlined, ExperimentOutlined, FileTextOutlined, HddOutlined, CloudUploadOutlined, FundProjectionScreenOutlined } from '@ant-design/icons';
import { Layout, Menu, Space, Switch } from 'antd';
import { FireOutlined, AlignCenterOutlined } from '@ant-design/icons';
import logoDarkMode from './logo-dark-small.png'
import logoWhiteMode from './logo-light-small.png'
import Image from 'next/image';

const { Sider } = Layout;

const Sidebar: React.FC = () => {
  const router = useRouter();
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  const changeTheme = (value: boolean) => {
    setTheme(value ? 'dark' : 'light');
  };

  const navigate = (path: string) => {
    router.push(path);
  };

  return (
    <Sider theme={theme} width={200} style={{ paddingTop: '5px', paddingLeft: '10px', paddingRight: '10px' }}>
      <div style={{
        padding: 10,
        marginBottom: 80,
        marginTop: 25,

      }}>
        <Image
          src={theme == 'dark' ? logoDarkMode : logoWhiteMode}
          width={100}
          style={{ display: 'block', margin: '0 auto' }}
          alt="Picture of the author"

        />
      </div>

      <Menu
        mode="inline"
        defaultSelectedKeys={['1']}
        defaultOpenKeys={['sub1']}
        style={{ borderRight: 0 }}
        theme={theme}
      >
        <Menu.Item key="1" icon={< ExperimentOutlined />} onClick={() => navigate('/playground')}>
          Playground
        </Menu.Item>

        <Menu.Item key="2" icon={< HddOutlined />} onClick={() => navigate('/datasets')}>
          Datasets
        </Menu.Item>
        <Menu.Item key="3" icon={<AppstoreOutlined />} onClick={() => navigate('/evaluations')}>
          Evaluate
        </Menu.Item>
        <Menu.Item key="4" icon={<FundProjectionScreenOutlined />} onClick={() => navigate('/results')}>
          Results
        </Menu.Item>
        <Menu.Item key="5" icon={<CloudUploadOutlined />} onClick={() => navigate('/deployements')}>
          Deployements
        </Menu.Item>
        <Menu.Item key="6" icon={<MailOutlined />} onClick={() => navigate('/logs')}>
          Monitor
        </Menu.Item>

      </Menu>
    </Sider>
  );
};

export default Sidebar;
