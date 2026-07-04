<script lang="ts">
  import { Box, Text, Button } from '@plures/design-dojo';

   
  let locked = $state(true);
   
  let secretCount = $state(4);
</script>

<Box gap="8px">
  <Box direction="row" justify="space-between" align="center">
    <Text weight="600" color={locked ? 'var(--color-danger)' : 'var(--color-success, #22c55e)'}>
      {locked ? '🔒 Locked' : '🔓 Open'}
    </Text>
    <Text size="0.85rem">{secretCount} secrets</Text>
  </Box>
  <Button variant={locked ? 'primary' : 'ghost'} onclick={() => locked = !locked}>
    {locked ? 'Unlock' : 'Lock'}
  </Button>
</Box>
