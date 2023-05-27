import React from 'react';
import { Layout, theme } from 'antd';
import Sidebar from '../Sidebar/Sidebar';
import { HeartTwoTone } from '@ant-design/icons';

type LayoutProps = {
  children: React.ReactNode
}

const { Content, Footer } = Layout;

const App: React.FC<LayoutProps> = ({ children }) => {

  const {
    token: { colorBgContainer },
  } = theme.useToken();

  return (
    <Layout>
      <Layout hasSider>
        <Sidebar />
        <Content >
          <div style={{ padding: 20, background: colorBgContainer, minHeight: '95vh' }}>
            {children}
          </div>
        </Content>
      </Layout>
      <Footer style={{ textAlign: 'center' }}>
        <div>
          <span>Agenta © 2023. Made with</span>
          <span> <HeartTwoTone twoToneColor="#eb2f96" /> </span>
          <span>in Berlin.</span>
        </div>
      </Footer>
    </Layout>
  );
};

export default App;
