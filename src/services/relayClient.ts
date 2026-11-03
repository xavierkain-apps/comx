// HTTP calls to the ComX relay. Every call returns null on any failure: the
// callers retry at the next sync.

import {COMX_RELAY_KEY, COMX_RELAY_URL} from '@env';
import {RelayClip, SyncRequest, SyncResponse} from '../ride/relay';
import {appLog} from '../utils/logger';

const TIMEOUT_MS = 8_000;
const BASE_URL = (COMX_RELAY_URL ?? '').replace(/\/+$/, '');

export const relayEnabled = !!(BASE_URL && COMX_RELAY_KEY);
export const relaySettings = {url: BASE_URL, key: COMX_RELAY_KEY ?? ''};

async function call<T>(path: string, init: RequestInit, read: (res: Response) => Promise<T>): Promise<T | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: abort.signal,
      headers: {'content-type': 'application/json', 'x-comx-key': COMX_RELAY_KEY ?? ''},
    });
    if (res.ok) return await read(res);
    appLog('Relay', `${path.split('/').pop()}: HTTP ${res.status}`);
    return null;
  } catch (e) {
    appLog('Relay', `network failure: ${String(e)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function relaySync(channel: string, body: SyncRequest): Promise<SyncResponse | null> {
  return call(`/v1/channels/${channel}/sync`, {method: 'POST', body: JSON.stringify(body)}, res =>
    res.json() as Promise<SyncResponse>,
  );
}

export async function relayUploadClip(channel: string, clip: RelayClip): Promise<boolean> {
  return !!(await call(`/v1/channels/${channel}/clips`, {method: 'POST', body: JSON.stringify(clip)}, async () => true));
}

export function relayDownloadClip(channel: string, id: string): Promise<RelayClip | null> {
  return call(`/v1/channels/${channel}/clips/${id}`, {method: 'GET'}, res => res.json() as Promise<RelayClip>);
}
