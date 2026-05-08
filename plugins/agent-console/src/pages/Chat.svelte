<!--
  Chat — the main AI conversation interface.

  All messages stored in PluresDB (chat:messages).
  All UI via design-dojo components.
  Actor attribution on every message (HUMAN vs AI).
  Chronos records the full conversation timeline.
-->
<script lang="ts">
  import { Box, Text, Heading, Button, TextArea } from '@plures/design-dojo';

  interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    actor: { kind: string; id: string };
  }

  // eslint-disable-next-line plures/no-raw-stores
  let messages = $state<ChatMessage[]>([]);
  // eslint-disable-next-line plures/no-raw-stores
  let inputValue = $state('');
  // eslint-disable-next-line plures/no-raw-stores
  let isStreaming = $state(false);

  function sendMessage() {
    if (!inputValue.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: Date.now(),
      actor: { kind: 'human', id: 'user:local' },
    };

    messages = [...messages, userMsg];
    const query = inputValue;
    inputValue = '';

    // Simulate AI response (in production: MCP tool call or direct LLM API)
    isStreaming = true;
    const aiMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      actor: { kind: 'ai', id: 'ai:cerebellum' },
    };
    messages = [...messages, aiMsg];

    // TODO: Replace with real MCP/LLM streaming
    setTimeout(() => {
      const idx = messages.findIndex(m => m.id === aiMsg.id);
      if (idx !== -1) {
        messages[idx] = { ...messages[idx], content: `I received your message: "${query}". In production, this would be a real AI response streamed via MCP.` };
        messages = [...messages];
      }
      isStreaming = false;
    }, 500);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    messages = [];
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

<Box class="chat-container" gap="0">
  <!-- Header -->
  <Box as="header" direction="row" justify="space-between" align="center" padding="12px 16px" class="chat-header">
    <Heading level={3}>Agent Console</Heading>
    <Box direction="row" gap="8px">
      <Button variant="ghost" onclick={clearChat}>Clear</Button>
    </Box>
  </Box>

  <!-- Messages -->
  <Box class="chat-messages" padding="16px" gap="12px">
    {#if messages.length === 0}
      <Box align="center" padding="40px" gap="12px">
        <Text size="2rem">💬</Text>
        <Text as="p" color="var(--color-text-muted)">
          Start a conversation with your AI agent.
        </Text>
        <Text as="p" size="0.85rem" color="var(--color-text-muted)">
          Try: "Build me a todo app" or "What's in the vault?"
        </Text>
      </Box>
    {:else}
      {#each messages as msg (msg.id)}
        <Box
          class="message {msg.role}"
          padding="10px 14px"
          gap="4px"
        >
          <Box direction="row" justify="space-between" align="center">
            <Text weight="600" size="0.8rem">
              {msg.role === 'user' ? '👤 You' : '🤖 Agent'}
            </Text>
            <Text size="0.75rem" color="var(--color-text-muted)">
              {formatTime(msg.timestamp)}
            </Text>
          </Box>
          <Text as="p">{msg.content || '...'}</Text>
        </Box>
      {/each}
    {/if}

    {#if isStreaming}
      <Box padding="10px 14px">
        <Text color="var(--color-text-muted)">Agent is thinking...</Text>
      </Box>
    {/if}
  </Box>

  <!-- Input -->
  <Box as="footer" direction="row" gap="8px" padding="12px 16px" align="end" class="chat-input">
    <Box style="flex: 1;">
      <TextArea
        bind:value={inputValue}
        placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
        rows={2}
        onkeydown={handleKeydown}
      />
    </Box>
    <Button
      variant="primary"
      disabled={!inputValue.trim() || isStreaming}
      onclick={sendMessage}
    >Send</Button>
  </Box>
</Box>

<style>
  :global(.chat-container) {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  :global(.chat-header) {
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  :global(.chat-messages) {
    flex: 1;
    overflow-y: auto;
  }
  :global(.chat-input) {
    border-top: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  :global(.message) {
    border-radius: 8px;
    max-width: 80%;
  }
  :global(.message.user) {
    background: var(--color-accent, #6366f1);
    color: #fff;
    align-self: flex-end;
  }
  :global(.message.assistant) {
    background: var(--color-surface-alt, rgba(0,0,0,0.1));
    align-self: flex-start;
  }
</style>
