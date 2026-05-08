/**
 * Agent Console Plugin — the AI chat interface for pares-radix.
 *
 * This is where the user talks to the AI and the AI talks back.
 * When paired with the Canvas plugin, the AI can create apps
 * in real-time while chatting.
 *
 * Architecture:
 * - Messages stored in PluresDB (chat:messages namespace)
 * - Streaming responses via MCP or direct LLM API
 * - Chronos records every message exchange
 * - Actor model: user messages = HUMAN, AI responses = AI (provisional until complete)
 * - design-dojo components only
 *
 * MCP tools:
 * - chat.send — send a message to the AI
 * - chat.history — get conversation history
 * - chat.clear — clear conversation
 * - chat.context — get/set system context
 */

import type { RadixPlugin } from '@plures/pares-radix';

export const agentConsolePlugin: RadixPlugin = {
  id: 'agent-console',
  name: 'Agent Console',
  version: '0.1.0',
  icon: '💬',
  description: 'AI chat interface — talk to your agent, build apps together',
  dependencies: [],

  routes: [
    { path: '/', component: () => import('./pages/Chat.svelte'), title: 'Chat' },
  ],

  navItems: [
    { href: '/agent-console', label: 'Chat', icon: '💬' },
  ],

  settings: [
    { key: 'chat.model', type: 'text', label: 'Model', default: 'claude-opus-4', group: 'AI' },
    { key: 'chat.systemPrompt', type: 'text', label: 'System prompt', default: 'You are a helpful assistant.', group: 'AI' },
    { key: 'chat.maxHistory', type: 'number', label: 'Max history messages', default: 100, group: 'AI' },
  ],

  dashboardWidgets: [
    {
      id: 'chat.quick',
      title: '💬 Quick Chat',
      component: () => import('./pages/widgets/QuickChat.svelte'),
      colspan: 2,
      priority: 5,
    },
  ],

  rules: [],
  expectations: [],
  constraints: [],

  async onActivate(_ctx) {
    // Initialize chat state in PluresDB
  },
};

export default agentConsolePlugin;
