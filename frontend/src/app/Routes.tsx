import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import App from './App';
import { AccountPage } from '@/features/account/AccountPage';
import { WorkspacePage } from '@/features/account/WorkspacePage';
import type { AccountMode } from '@/features/account/forms';
import { PortalPage } from '@/features/portal/PortalPage';

const modes: AccountMode[] = [
  'login',
  'register',
  'forgot',
  'verify',
  'reset',
  'invite',
];
export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/app" element={<WorkspacePage />} />
        <Route path="/book/:slug" element={<PortalPage />} />
        {modes.map((mode) => (
          <Route
            key={mode}
            path={`/account/${mode}`}
            element={<AccountPage key={mode} mode={mode} />}
          />
        ))}
        <Route
          path="*"
          element={
            <main>
              <h1>Page not found</h1>
              <Link to="/">Return to SlotWise</Link>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
