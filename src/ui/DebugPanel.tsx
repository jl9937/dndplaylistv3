import { useState } from 'react';
import { expireAccessTokenNow } from '../auth/auth';
import { BUILD_ID } from '../config';
import { webPlayback } from '../player/instance';
import { faults, formatLog, log } from '../diagnostics/log';
import { useLog } from './hooks';

export function DebugPanel({ onClose }: { onClose: () => void }) {
  const events = useLog();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(formatLog(events));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <aside className="debug">
      <header>
        <strong>Log ({events.length})</strong>
        <span className="build">build {BUILD_ID}</span>
        <button onClick={copy}>{copied ? 'Copied' : 'Copy log'}</button>
        <button onClick={expireAccessTokenNow}>Expire access token now</button>
        <button
          onClick={() => {
            faults.simulate401Next = true;
            log('app', 'debug: next request will get a 401');
          }}
        >
          Simulate 401 on next request
        </button>
        <button onClick={() => webPlayback.kill()}>Kill SDK player</button>
        <button onClick={onClose} aria-label="Close log">×</button>
      </header>
      <ol className="events">
        {events
          .slice()
          .reverse()
          .map((e, i) => (
            <li key={`${e.t}-${i}`}>
              <time>{new Date(e.t).toLocaleTimeString()}</time> <span className={`kind ${e.kind}`}>{e.kind}</span>{' '}
              {e.msg}
            </li>
          ))}
      </ol>
    </aside>
  );
}
