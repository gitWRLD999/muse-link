// Keep the pinned upstream MCP implementation. Only its extension selector
// launch gets a dedicated window; no browser profile or cookies are copied.
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const childProcess=require('node:child_process');
const original=childProcess.spawn;
let bounds;
try {bounds=JSON.parse(process.env.MUSE_CHROME_BOUNDS||'null');}catch{}
childProcess.spawn=function(command,args,options) {
  if(bounds && Array.isArray(args) && args.some(a=>typeof a==='string' && a.startsWith('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html'))) {
    const values=[bounds.x,bounds.y,bounds.width,bounds.height];
    if(values.every(Number.isInteger) && bounds.width>200 && bounds.height>200)
      args=[...args.slice(0,-1),'--new-window',`--window-position=${bounds.x+40},${bounds.y+40}`,`--window-size=${Math.min(1400,bounds.width-80)},${Math.min(940,bounds.height-80)}`,args.at(-1)];
  }
  return original.call(this,command,args,options);
};
const cli=path.join(path.dirname(require.resolve('@playwright/mcp/package.json')),'cli.js');
process.argv=[process.execPath,cli,...process.argv.slice(2)];
require(cli);
