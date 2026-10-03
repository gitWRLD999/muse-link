import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function loadConfig(env = process.env) {
  const home = path.resolve(env.MUSE_LINK_HOME || (process.platform === 'win32'
    ? path.join(env.USERPROFILE || os.homedir(), 'AgentTools', 'MuseLink')
    : path.join(os.homedir(), '.local', 'state', 'muse-link')));
  const configPath = path.resolve(env.MUSE_LINK_CONFIG || path.join(home, 'config.json'));
  let config = {};
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('Config must be an object');
  const port = Number(env.MUSE_LINK_PORT || (config.port ?? 18921));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid loopback port');
  const stateDir = path.resolve(env.MUSE_LINK_STATE_DIR || config.stateDir || path.join(home, 'state'));
  const artifactsDir = path.resolve(config.artifactsDir || path.join(home, 'artifacts'));
  const engines = config.engines ?? {chrome: {kind: 'chrome'}, sidescreen: {kind: 'sidescreen'}};
  if (!engines || typeof engines !== 'object' || Array.isArray(engines)) throw Error('engines must be an object');
  for (const [name, spec] of Object.entries(engines)) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name) || !spec || !['chrome', 'mcp', 'desktop', 'sidescreen', 'agent', 'assist'].includes(spec.kind)) throw Error(`Invalid engine: ${name}`);
    if(spec.kind==='assist')for(const field of ['winappBinary','python','ufoDirectory','omniDirectory','modelFile','ocrDirectory'])if(typeof spec[field]!=='string'||!path.isAbsolute(spec[field]))throw Error(`${name}: ${field} must be absolute`);
    if(spec.kind==='agent'&&spec.assist&&engines[spec.assist]?.kind!=='assist')throw Error(`${name}: invalid assist engine`);
    if (['mcp', 'desktop'].includes(spec.kind) && (typeof spec.command !== 'string' || !spec.command.trim())) throw Error(`${name}: command is required`);
    if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.some(a => typeof a !== 'string'))) throw Error(`${name}: args must be strings`);
    if (spec.env !== undefined && (!spec.env || typeof spec.env !== 'object' || Array.isArray(spec.env) || Object.values(spec.env).some(v => typeof v !== 'string'))) throw Error(`${name}: env values must be strings`);
    if (spec.cwd !== undefined && (typeof spec.cwd !== 'string' || !path.isAbsolute(spec.cwd))) throw Error(`${name}: cwd must be absolute`);
    if (spec.directory !== undefined && (typeof spec.directory !== 'string' || !path.isAbsolute(spec.directory))) throw Error(`${name}: directory must be absolute`);
    if (spec.profile !== undefined && typeof spec.profile !== 'string') throw Error(`${name}: profile must be a string`);
    if (spec.aliasOf !== undefined && (!Object.hasOwn(engines,spec.aliasOf) || engines[spec.aliasOf].kind!==spec.kind || engines[spec.aliasOf].aliasOf)) throw Error(`${name}: invalid aliasOf`);
  }
  return {home, configPath, port, stateDir, artifactsDir, engines};
}
