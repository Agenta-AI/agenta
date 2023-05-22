// components/Header/Header.tsx
import { Layout, Breadcrumb, Avatar, theme, Row, Col } from 'antd';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Logo from './Logo'; // create this component to display your logo
import { useContext } from 'react';
import appContext from '@/contexts/appContext';
import useResetApp from '@/hooks/useResetApp';
type User = {
  name: string;
  avatar: string;
};

type HeaderProps = {
  user: User;
};

const { Header } = Layout;

const AppHeader: React.FC<HeaderProps> = ({ user }) => {
  const resetApp = useResetApp();
  // get the app name from the current route
  const appName = useContext(appContext);

  return (
    <Header style={{ background: '#ffffff', }} >
      <div style={{ paddingTop: 30 }}>
        <Breadcrumb items={[
          {
            title: <Link href="/" onClick={resetApp}>
              / apps
            </Link>,
          },
          {
            title: <Link href="/playground">
              {appName.app}
            </Link>,
            key: 'appName',
          },

        ]} />
      </div>
    </Header >
  );
};

export default AppHeader;
