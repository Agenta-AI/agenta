import React, { useState } from 'react';
import { useRouter } from 'next/router';
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
    <Sider theme={theme} width={250} style={{ paddingTop: '5px', paddingLeft: '15px', paddingRight: '15px' }}>
      <Switch
        checked={theme === 'dark'}
        onChange={changeTheme}
        checkedChildren="Dark"
        unCheckedChildren="Light"
        style={{ marginTop: '20px' }}
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
        defaultSelectedKeys={['1']}
        defaultOpenKeys={['sub1']}
        style={{ borderRight: 0 }}
        theme={theme}
      >
        <Menu.Item key="1" icon={<AlignCenterOutlined />} onClick={() => navigate('/logs')}>
          Logs
        </Menu.Item>
        <Menu.Item key="2" icon={<FireOutlined />} onClick={() => navigate('/evaluations')}>
          Playground
        </Menu.Item>
      </Menu>
    </Sider>
  );
};

export default Sidebar;
