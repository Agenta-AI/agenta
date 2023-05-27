import React from 'react';
import { Breadcrumb, Layout, theme } from 'antd';
import Sidebar from '../Sidebar/Sidebar';
import { HeartTwoTone } from '@ant-design/icons';
import { useRouter } from 'next/router';
import Link from 'next/link';
type LayoutProps = {
  children: React.ReactNode
}

const { Content, Footer } = Layout;

const App: React.FC<LayoutProps> = ({ children }) => {
  const router = useRouter();
  const { app_name } = router.query
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  return (
    <Layout>
      <Layout hasSider>
        <Sidebar />
        <Content >
          <div style={{ padding: 20, background: colorBgContainer, minHeight: '95vh' }}>
            <Breadcrumb
              style={{ marginTop: '20px', marginBottom: '40px' }}
              items={[
                { title: <Link href="/apps">Apps</Link> },
                { title: app_name }
              ]}
            />
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
