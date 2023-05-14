import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { Layout, Menu, Switch } from 'antd';
import { MailOutlined, AppstoreOutlined } from '@ant-design/icons';

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
    <Sider theme={theme} width={200} style={{ paddingTop: '5px', paddingLeft: '5px', paddingRight: '5px' }}>
      <Switch
        checked={theme === 'dark'}
        onChange={changeTheme}
        checkedChildren="Dark"
        unCheckedChildren="Light"
        style={{ marginTop: '10px', marginBottom: '20px', }}
      />
      <Menu
        mode="inline"
        defaultSelectedKeys={['1']}
        defaultOpenKeys={['sub1']}
        style={{ height: '100%', borderRight: 0 }}
        theme={theme}
      >
        <Menu.Item key="1" icon={<AppstoreOutlined />} onClick={() => navigate('/playground')}>
          Playground
        </Menu.Item>
        <Menu.Item key="2" icon={<AppstoreOutlined />} onClick={() => navigate('/evaluations')}>
          Evaluations
        </Menu.Item>
        <Menu.Item key="3" icon={<MailOutlined />} onClick={() => navigate('/logs')}>
          Logs
        </Menu.Item>

      </Menu>
    </Sider>
  );
};

export default Sidebar;
