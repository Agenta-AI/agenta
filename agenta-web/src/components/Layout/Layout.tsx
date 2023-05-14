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
      < Sidebar />
      {/* <Header style={{ padding: 0, background: colorBgContainer }} /> */}
      < Content style={{ margin: '0 5px' }}>

        <div style={{ padding: 24, background: colorBgContainer, minHeight: '100vh' }}>
          {children}
        </div>
      </Content >
    </Layout >
  );
};

export default App;
