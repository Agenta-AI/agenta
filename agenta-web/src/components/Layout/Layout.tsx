import React from 'react';
import { Layout, theme } from 'antd';
import Sidebar from '../Sidebar/Sidebar';
import { HeartTwoTone } from '@ant-design/icons';
import { useRouter } from 'next/router';
import Header from '../Header/Header';

type LayoutProps = {
  children: React.ReactNode
}
type User = {
  name: string;
  avatar: string;
};

const { Content, Footer } = Layout;
const mockUser: User = {
  name: 'Foulen',
  avatar: 'https://example.com/john-doe.jpg',
};

const App: React.FC<LayoutProps> = ({ children }) => {

  const {
    token: { colorBgContainer },
  } = theme.useToken();
  const router = useRouter();

  return (
    <Layout >
      <Layout style={{ marginTop: '2px' }}>
        {router.pathname !== '/' && <Sidebar />}
        <Content style={{ margin: '0 2px' }}>
        <Header user={mockUser} />
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
