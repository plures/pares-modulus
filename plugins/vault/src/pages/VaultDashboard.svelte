<script lang="ts">
  import { Box, Heading, Text, Button } from '@plures/design-dojo';

  // eslint-disable-next-line plures/no-raw-stores
  let locked = $state(true);
  // eslint-disable-next-line plures/no-raw-stores
  let secretCount = $state(0);
  // eslint-disable-next-line plures/no-raw-stores
  let lastRotation = $state('Never');
  // eslint-disable-next-line plures/no-raw-stores
  let pendingRotations = $state(0);
</script>

<Box padding="24px" gap="20px">
  <Heading level={1}>Vault Dashboard</Heading>

  <Box direction="row" gap="16px" wrap>
    <Box padding="16px" gap="8px" class="card">
      <Text size="0.8rem" color="var(--color-text-muted)">Status</Text>
      <Text size="1.5rem" weight="700" color={locked ? 'var(--color-danger)' : 'var(--color-success, #22c55e)'}>
        {locked ? '🔒 Locked' : '🔓 Unlocked'}
      </Text>
      <Button variant={locked ? 'primary' : 'danger'} onclick={() => locked = !locked}>
        {locked ? 'Unlock' : 'Lock'}
      </Button>
    </Box>

    <Box padding="16px" gap="8px" class="card">
      <Text size="0.8rem" color="var(--color-text-muted)">Secrets</Text>
      <Text size="1.5rem" weight="700">{secretCount}</Text>
    </Box>

    <Box padding="16px" gap="8px" class="card">
      <Text size="0.8rem" color="var(--color-text-muted)">Last Rotation</Text>
      <Text size="1rem" weight="500">{lastRotation}</Text>
    </Box>

    <Box padding="16px" gap="8px" class="card">
      <Text size="0.8rem" color="var(--color-text-muted)">Pending Rotations</Text>
      <Text size="1.5rem" weight="700" color={pendingRotations > 0 ? 'var(--color-warning, #f59e0b)' : 'var(--color-text)'}>
        {pendingRotations}
      </Text>
    </Box>
  </Box>

  {#if !locked}
    <Box gap="12px">
      <Heading level={2}>Quick Actions</Heading>
      <Box direction="row" gap="8px">
        <Button variant="primary">Add Secret</Button>
        <Button variant="secondary">Import from .env</Button>
        <Button variant="secondary">Rotate All Expired</Button>
        <Button variant="ghost">Export Metadata</Button>
      </Box>
    </Box>
  {:else}
    <Box padding="24px" align="center" gap="12px">
      <Text as="p" color="var(--color-text-muted)">
        Vault is locked. Enter your master password to access secrets.
      </Text>
    </Box>
  {/if}
</Box>

<style>
  :global(.card) {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    min-width: 160px;
    flex: 1;
  }
</style>
