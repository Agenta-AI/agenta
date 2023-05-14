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

        <div style={{ padding: 24, background: colorBgContainer }}>
          {children}
        </div>
      </Content >
    </Layout >
  );
};

export default App;

// import React from 'react';
// import { Layout, theme } from 'antd';
// import Sidebar from '../Sidebar/Sidebar';

// type LayoutProps = {
//   children: React.ReactNode
// }

// const { Header, Content, Footer } = Layout;

// const App: React.FC<LayoutProps> = ({ children }) => {

//   const {
//     token: { colorBgContainer },
//   } = theme.useToken();

//   return (
//     <Layout className="min-h-screen">
//       <Sidebar />
//       <Layout className="site-layout min-h-screen">
//         {/* <Header style={{ padding: 0, background: colorBgContainer }} /> */}
//         <Content className="flex-1 flex flex-col overflow-auto" style={{ margin: '0 5px' }}>

//           <div style={{ padding: 24, minHeight: 360, background: colorBgContainer }}>
//             {children}
//           </div>
//         </Content>
//       </Layout>
//     </Layout>
//   );
// };

// export default App;


// import React from 'react';
// import { Breadcrumb, Layout, Menu, theme } from 'antd';

// const { Header, Content, Footer } = Layout;

// const App: React.FC = () => {
//   const {
//     token: { colorBgContainer },
//   } = theme.useToken();

//   return (
//     <Layout className="layout">
//       <Header>
//         <div className="logo" />
//         <Menu
//           theme="dark"
//           mode="horizontal"
//           defaultSelectedKeys={['2']}
//           items={new Array(15).fill(null).map((_, index) => {
//             const key = index + 1;
//             return {
//               key,
//               label: `nav ${key}`,
//             };
//           })}
//         />
//       </Header>
//       <Content style={{ padding: '0 50px' }}>
//         <Breadcrumb style={{ margin: '16px 0' }}>
//           <Breadcrumb.Item>Home</Breadcrumb.Item>
//           <Breadcrumb.Item>List</Breadcrumb.Item>
//           <Breadcrumb.Item>App</Breadcrumb.Item>
//         </Breadcrumb>
//         <div className="site-layout-content" style={{ background: colorBgContainer }}>
//           Content
//         </div>
//       </Content>
//       <Footer style={{ textAlign: 'center' }}>Ant Design ©2023 Created by Ant UED</Footer>
//     </Layout>
//   );
// };

// export default App;

// import React from 'react';
// import { LaptopOutlined, NotificationOutlined, UserOutlined } from '@ant-design/icons';
// import type { MenuProps } from 'antd';
// import { Breadcrumb, Layout, Menu, theme } from 'antd';

// const { Header, Content, Footer, Sider } = Layout;

// const items1: MenuProps['items'] = ['1', '2', '3'].map((key) => ({
//   key,
//   label: `nav ${key}`,
// }));

// const items2: MenuProps['items'] = [UserOutlined, LaptopOutlined, NotificationOutlined].map(
//   (icon, index) => {
//     const key = String(index + 1);

//     return {
//       key: `sub${key}`,
//       icon: React.createElement(icon),
//       label: `subnav ${key}`,

//       children: new Array(4).fill(null).map((_, j) => {
//         const subKey = index * 4 + j + 1;
//         return {
//           key: subKey,
//           label: `option${subKey}`,
//         };
//       }),
//     };
//   },
// );

// const App: React.FC = () => {
//   const {
//     token: { colorBgContainer },
//   } = theme.useToken();

//   return (
//     <Layout>
//       <Header className="header">
//         <div className="logo" />
//         <Menu theme="dark" mode="horizontal" defaultSelectedKeys={['2']} items={items1} />
//       </Header>
//       <Content style={{ padding: '0 50px' }}>
//         <Breadcrumb style={{ margin: '16px 0' }}>
//           <Breadcrumb.Item>Home</Breadcrumb.Item>
//           <Breadcrumb.Item>List</Breadcrumb.Item>
//           <Breadcrumb.Item>App</Breadcrumb.Item>
//         </Breadcrumb>
//         <Layout style={{ padding: '24px 0', background: colorBgContainer }}>
//           <Sider style={{ background: colorBgContainer }} width={200}>
//             <Menu
//               mode="inline"
//               defaultSelectedKeys={['1']}
//               defaultOpenKeys={['sub1']}
//               style={{ height: '100%' }}
//               items={items2}
//             />
//           </Sider>
//           <Content style={{ padding: '0 24px', minHeight: 280 }}>Content</Content>
//         </Layout>
//       </Content>
//       <Footer style={{ textAlign: 'center' }}>Ant Design ©2023 Created by Ant UED</Footer>
//     </Layout>
//   );
// };

// export default App;
