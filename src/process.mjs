import {spawn} from 'node:child_process';

// One JSON request/response process. Never retry an action after an unknown outcome.
export function runJson(spec, request, {timeout = 30000, maxBytes = 8 * 1024 * 1024} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command === 'node' ? process.execPath : spec.command, spec.args || [], {
      cwd: spec.cwd, env: {...process.env, ...spec.env}, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    const chunks = [];
    let size = 0, errors = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill(); finish(Error('Action timed out; outcome unknown. Observe before continuing; never retry automatically.'));
    }, timeout);
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { child.kill(); finish(Error('Response too large; outcome unknown.')); }
      else chunks.push(chunk);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
    child.on('close', () => {
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(Error(errors || 'Invalid adapter JSON; outcome unknown.')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
