import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { Layout, Menu, Switch } from 'antd';
import { MailOutlined, AppstoreOutlined, ExperimentOutlined, FileTextOutlined, HddOutlined } from '@ant-design/icons';

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
      <Menu
        mode="inline"
        defaultSelectedKeys={['1']}
        defaultOpenKeys={['sub1']}
        style={{ height: '100%', borderRight: 0 }}
        theme={theme}
      >
        <Menu.Item key="1" icon={< HddOutlined />} onClick={() => navigate('/datasets')}>
          Datasets
        </Menu.Item>
        <Menu.Item key="2" icon={< ExperimentOutlined />} onClick={() => navigate('/playground')}>
          Playground
        </Menu.Item>
        <Menu.Item key="3" icon={<FileTextOutlined />} onClick={() => navigate('/testsets')}>
          Tests sets
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
