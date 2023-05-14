import React from 'react';
import { Layout, theme } from 'antd';
import Sidebar from '../Sidebar/Sidebar';

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
        {/* <Header style={{ padding: 0, background: colorBgContainer }} /> */}
        <Content style={{ margin: '0 16px' }}>

          <div style={{ padding: 24, minHeight: 360, background: colorBgContainer }}>
            {children}
          </div>
        </Content>
      </Layout>
    </Layout>
  );
};

export default App;