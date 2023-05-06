import { Inter } from 'next/font/google'
import { useRouter } from 'next/router';
import React, { useEffect } from 'react';
const inter = Inter({ subsets: ['latin'] })

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.push('/dashboard');
  }, [router]);

  return (
    <div>
      {/* You can display a loading message or spinner here */}
      Redirecting to main page...
    </div>
  );
};