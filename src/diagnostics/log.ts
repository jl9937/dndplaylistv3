// In-memory ring buffer of the last 200 events (spec §12.8). Nothing here leaves the browser.

export type LogKind = 'api' | 'auth' | 'pipeline' | 'device' | 'app';

export interface LogEvent {
  t: number;
  kind: LogKind;
  msg: string;
}

const MAX_EVENTS = 200;
const events: LogEvent[] = [];
const listeners = new Set<() => void>();
let snapshot: readonly LogEvent[] = [];

/** Developer fault injection, driven from the debug panel. */
export const faults = {
  simulate401Next: false,
};

/** Drop the query string and fragment: they can carry `code`, `state` or tokens. */
export function scrubUrl(url: string): string {
  return url.split(/[?#]/, 1)[0];
}

/** Last line of defence: never let anything that looks like a secret into the log. */
export function scrubText(text: string): string {
  return text
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\b(code|state|access_token|refresh_token|code_verifier)=[^&\s"']+/gi, '$1=[redacted]')
    .replace(/\?[^\s"']*/g, '');
}

export function log(kind: LogKind, msg: string): void {
  events.push({ t: Date.now(), kind, msg: scrubText(msg) });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  snapshot = events.slice();
  listeners.forEach((fn) => fn());
}

export function getLog(): readonly LogEvent[] {
  return snapshot;
}

export function subscribeLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function formatLog(list: readonly LogEvent[] = snapshot): string {
  return list
    .map((e) => `${new Date(e.t).toISOString()} [${e.kind}] ${e.msg}`)
    .join('\n');
}

export function clearLogForTests(): void {
  events.length = 0;
  snapshot = [];
}
