import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema, CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const server = new Server({name: 'transport-test', version: '1'}, {capabilities: {tools: {}}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: [{name: 'echo', description: 'Test echo', inputSchema: {type: 'object', additionalProperties: true}}]}));
server.setRequestHandler(CallToolRequestSchema, async req => ({content: [{type: 'text', text: JSON.stringify(req.params.arguments)}], isError: req.params.arguments?.fail === true}));
await server.connect(new StdioServerTransport());
