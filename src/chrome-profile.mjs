import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Metadata only: never read cookies, account identifiers or passwords.
export function chromeProfileInfo(spec,env=process.env) {
  const info={directory:spec.profile||null,source:'configuration',browserAccountConfigured:null,extensionInstalled:null,siteLogin:'not-checked'};
  const root=env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Google','Chrome','User Data');
  if(root&&spec.profile)try {
    const state=JSON.parse(readFileSync(path.join(root,'Local State'),'utf8'));
    const metadata=state.profile?.info_cache?.[spec.profile];
    if(metadata){info.source='local-chrome-metadata';info.browserAccountConfigured=!!metadata.user_name;}
    info.extensionInstalled=existsSync(path.join(root,spec.profile,'Extensions','mmlmfjhmonkocbjadbfplnigmagldckm'));
  }catch{ /* Not permission to fall back to another profile. */ }
  return info;
}
export function extensionTokenHash(spec,env=process.env) {
  const token=spec.env?.PLAYWRIGHT_MCP_EXTENSION_TOKEN||env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
  return token?createHash('sha256').update(token).digest('hex'):null;
}
