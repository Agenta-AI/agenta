import React from 'react';
import { Layout, theme } from 'antd';
import Sidebar from '../Sidebar/Sidebar';
import { HeartTwoTone } from '@ant-design/icons';

type LayoutProps = {
  children: React.ReactNode
}

const { Header, Content, Footer } = Layout;

const App: React.FC<LayoutProps> = ({ children }) => {

  const {
    token: { colorBgContainer },
  } = theme.useToken();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar />
      <Layout className="site-layout">
        <Content style={{ margin: '0 16px' }}>
          <div style={{ padding: 24, minHeight: 360, background: colorBgContainer }}>
            {children}
          </div>
        </Content>

        <Footer style={{ textAlign: 'center' }}>
          <div>
            <span>Agenta © 2023. Made with</span>
            <span> <HeartTwoTone twoToneColor="#eb2f96" /> </span>
            <span>in Berlin.</span>
          </div>
          </Footer>
      </Layout>
    </Layout>
  );
};

export default App;
