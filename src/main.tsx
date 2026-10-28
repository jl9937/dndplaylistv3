import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { handleCallback } from './auth/auth';
import { BUILD_ID } from './config';
import { log } from './diagnostics/log';
import { App } from './App';
import './styles.css';

// The ?code callback runs exactly once, here, before React renders (spec §12.5).
// Never in an effect: StrictMode would run it twice.
log('app', `build ${BUILD_ID}`);

const root = document.getElementById('root')!;
root.textContent = 'Loading…';

void handleCallback().then((callback) => {
  createRoot(root).render(
    <StrictMode>
      <App callback={callback} />
    </StrictMode>,
  );
});
