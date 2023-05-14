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
      < Sidebar />
      {/* <Header style={{ padding: 0, background: colorBgContainer }} /> */}
      <Layout className="site-layout">

      < Content style={{ margin: '0 5px' }}>

        <div style={{ padding: 24, background: colorBgContainer, minHeight: '100vh' }}>
          {children}
        </div>
      </Content >
        <Footer style={{ textAlign: 'center' }}>
          <div>
            <span>Agenta © 2023. Made with</span>
            <span> <HeartTwoTone twoToneColor="#eb2f96" /> </span>
            <span>in Berlin.</span>
          </div>
          </Footer>
      </Layout>

    </Layout >
  );
};

export default App;
