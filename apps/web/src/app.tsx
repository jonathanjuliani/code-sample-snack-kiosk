import { Kiosk } from './kiosk/kiosk';
import { OpsPage } from './ops';
import './styles/base.css';
import './styles/responsive.css';

const showingOps = typeof window !== 'undefined' && window.location.pathname === '/ops';
if (showingOps) document.documentElement.dataset.surface = 'ops';

export function App() {
  if (showingOps) return <OpsPage />;
  return <Kiosk />;
}
