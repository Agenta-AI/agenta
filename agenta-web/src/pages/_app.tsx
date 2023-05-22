// main _app.tsx
import '@/styles/globals.css'
import type { AppProps } from 'next/app'
import { useState } from 'react';
import Layout from '@/components/Layout/Layout';
import AppContext from '@/contexts/appContext';

export default function App({ Component, pageProps }: AppProps) {
  const [app, setApp] = useState('');

  return (
    <AppContext.Provider value={{ app, setApp }}>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </AppContext.Provider>
  );
}
