import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {rpc} from './rpc.mjs';

export async function startMcp(config, engine) {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(engine || '')) throw Error('An engine name is required');
  let desktop;
  async function listTools() {
    const list = await rpc(config, {engine, method: 'list'});
    desktop = list.tools.length > 0 && list.tools.every(tool => typeof tool === 'string');
    return list;
  }
  const server = new Server({name: `muse-link-${engine}`, version: '1.2.0'}, {capabilities: {tools: {}}});
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const list = await listTools();
    // Recognize the legacy desktop JSON adapter without copying its private source.
    if (!desktop) return list;
    return {tools: [{name: 'desktop_action', description: 'Windows desktop action. Observe before input. Global desktop input can steal focus; prefer SideScreen where applicable. Never retry an unknown outcome.', inputSchema: {
      type: 'object', properties: {action: {type: 'string', enum: list.tools}, arguments: {type: 'object', additionalProperties: true}}, required: ['action'], additionalProperties: false
    }}]};
  });
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      if (desktop === undefined) await listTools();
      if (!desktop) return await rpc(config, {engine, method: 'call', tool: request.params.name, arguments: request.params.arguments || {}});
      if (request.params.name !== 'desktop_action') throw Error('Unknown desktop tool');
      const args = request.params.arguments || {};
      const result = await rpc(config, {engine, method: 'call', tool: args.action, arguments: args.arguments || {}});
      if (result.result?.png_base64) return {isError: result.ok === false, content: [{type: 'image', mimeType: 'image/png', data: result.result.png_base64}]};
      return {isError: result.ok === false, content: [{type: 'text', text: JSON.stringify(result)}]};
    } catch (error) { return {isError: true, content: [{type: 'text', text: error.message}]}; }
  });
  await server.connect(new StdioServerTransport());
  return server;
}
