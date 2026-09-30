import {readFileSync} from 'node:fs';
import path from 'node:path';

export async function rpc(config, request) {
  let token;
  try { token = readFileSync(path.join(config.stateDir, 'token'), 'utf8').trim(); }
  catch { throw Error('No broker token. Start Muse Link in the signed-in Windows session.'); }
  const response = await fetch(`http://127.0.0.1:${config.port}/rpc`, {
    method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
    body: JSON.stringify(request), signal: AbortSignal.timeout(150000)
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
  return result;
}
