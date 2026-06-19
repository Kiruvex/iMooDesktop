// src/App.tsx - 根组件 + 路由
// 见 plan.md 9.1 路由

import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { EulaModal } from './components/common/EulaModal';
import { SplashScreen } from './components/common/SplashScreen';
import { useDevice } from './hooks/useDevice';
import { useLogs } from './hooks/useLogs';
import { useSettingsStore } from './stores/settingsStore';
import { Home } from './routes/Home';
import { Settings } from './routes/Settings';
import { Logs } from './routes/Logs';
import { Reboot } from './routes/Reboot';
import { Cloud } from './routes/Cloud';
import { Apps } from './routes/Apps';
import { Tools } from './routes/Tools';
import { Magisk } from './routes/Magisk';
import { Backup } from './routes/Backup';
import { Root } from './routes/Root';
import { Files } from './routes/Files';
import { EdlPartitions } from './routes/EdlPartitions';

export default function App(): JSX.Element {
  const loadSettings = useSettingsStore((s) => s.load);
  useDevice();
  useLogs();

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/reboot" element={<Reboot />} />
        <Route path="/cloud" element={<Cloud />} />
        <Route path="/apps" element={<Apps />} />
        <Route path="/files" element={<Files />} />
        <Route path="/edl-partitions" element={<EdlPartitions />} />
        <Route path="/tools" element={<Tools />} />
        <Route path="/magisk" element={<Magisk />} />
        <Route path="/backup" element={<Backup />} />
        <Route path="/root" element={<Root />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/logs" element={<Logs />} />
      </Routes>
      <EulaModal />
      <SplashScreen />
    </AppShell>
  );
}
