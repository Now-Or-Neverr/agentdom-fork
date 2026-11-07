import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AppProvider } from './lib/store';
import './styles.css';

// After a new deploy, an open tab may ask for page chunks that no longer exist.
// Reload once to pick up the new build instead of showing a broken page.
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (sessionStorage.getItem('agentdom.reloaded')) return;
    sessionStorage.setItem('agentdom.reloaded', '1');
  } catch {
    /* storage blocked: still reload once */
  }
  e.preventDefault();
  window.location.reload();
});
// Once the page has run fine for a while, allow that one reload again for the next deploy.
window.setTimeout(() => {
  try {
    sessionStorage.removeItem('agentdom.reloaded');
  } catch {
    /* ignore */
  }
}, 15_000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
