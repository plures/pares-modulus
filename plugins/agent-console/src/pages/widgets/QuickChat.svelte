<!--
  Quick Chat Widget — dashboard widget for fast AI interaction.
-->
<script lang="ts">
  import { Box, Text, Input, Button } from '@plures/design-dojo';

  // eslint-disable-next-line plures/no-raw-stores
  let quickInput = $state('');
  // eslint-disable-next-line plures/no-raw-stores
  let lastResponse = $state('');

  function quickAsk() {
    if (!quickInput.trim()) return;
    // TODO: MCP tool call
    lastResponse = `Working on: "${quickInput}"...`;
    quickInput = '';
  }
</script>

<Box gap="8px">
  <Box direction="row" gap="8px">
    <Box style="flex: 1;">
      <Input
        placeholder="Ask your agent..."
        bind:value={quickInput}
        name="quick-chat"
      />
    </Box>
    <Button variant="primary" onclick={quickAsk}>Ask</Button>
  </Box>
  {#if lastResponse}
    <Text as="p" size="0.85rem" color="var(--color-text-muted)">{lastResponse}</Text>
  {/if}
</Box>
