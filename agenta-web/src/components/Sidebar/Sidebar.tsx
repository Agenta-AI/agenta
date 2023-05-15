import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { MailOutlined, AppstoreOutlined, ExperimentOutlined, FileTextOutlined, HddOutlined } from '@ant-design/icons';
import { Layout, Menu, Space, Switch } from 'antd';
import { FireOutlined, AlignCenterOutlined } from '@ant-design/icons';
import logoDarkMode from './logo-dark-mode.png'
import logoWhiteMode from './logo-light-mode.png'
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
    <Sider theme={theme} width={160} style={{ paddingTop: '5px', paddingLeft: '0px', paddingRight: '0px' }}>
      <Switch
        checked={theme === 'dark'}
        onChange={changeTheme}
        checkedChildren="Dark"
        unCheckedChildren="Light"
        style={{ marginLeft: '5px', marginTop: '20px', marginBottom: '20px', }}
      />
      <div style={{
        display: 'flex',
        justifyContent: 'center',
      }}>
        <div style={{
          padding: 10,
          marginBottom: 30,
          marginTop: 30,
          border: `1px solid ${theme == 'dark' ? '#fff' : '#000'}`,
          borderRadius: '10px',
        }}>
          <Image
            src={theme == 'dark' ? logoDarkMode : logoWhiteMode}
            width={160}
            alt="Picture of the author"
          />
        </div>
      </div>

      <Menu
        mode="inline"
        defaultSelectedKeys={['2']}
        defaultOpenKeys={['sub1']}
        style={{ borderRight: 0 }}
        theme={theme}
      >
        <Menu.Item key="1" icon={< HddOutlined />} onClick={() => navigate('/datasets')}>
          Datasets
        </Menu.Item>
        <Menu.Item key="2" icon={< ExperimentOutlined />} onClick={() => navigate('/playground')}>
          Playground
        </Menu.Item>
        <Menu.Item key="3" icon={<FileTextOutlined />} onClick={() => navigate('/testsets')}>
          Test sets
        </Menu.Item>
        <Menu.Item key="4" icon={<AppstoreOutlined />} onClick={() => navigate('/evaluations')}>
          Evaluation
        </Menu.Item>

        <Menu.Item key="5" icon={<MailOutlined />} onClick={() => navigate('/logs')}>
          Logs
        </Menu.Item>

      </Menu>
    </Sider>
  );
};

export default Sidebar;
