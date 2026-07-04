<script lang="ts">
  import { Box, Heading, Text, Table } from '@plures/design-dojo';

  interface AuditEntry {
    timestamp: string;
    action: string;
    secret: string;
    actor: string;
    result: string;
  }

   
  let entries = $state<AuditEntry[]>([
    { timestamp: '2026-05-08 10:30', action: 'READ', secret: 'GITHUB_PAT', actor: 'ai:cerebellum', result: '✅ Allowed' },
    { timestamp: '2026-05-08 10:25', action: 'ROTATE', secret: 'ADO_PAT', actor: 'system:cron', result: '✅ Success' },
    { timestamp: '2026-05-08 09:00', action: 'READ', secret: 'DB_PASSWORD', actor: 'ai:cerebellum', result: '❌ Denied (policy)' },
    { timestamp: '2026-05-07 18:00', action: 'CREATE', secret: 'NEW_API_KEY', actor: 'user:kbristol', result: '✅ Created' },
  ]);
</script>

<Box padding="24px" gap="20px">
  <Heading level={1}>Audit Log</Heading>
  <Text as="p" color="var(--color-text-muted)">
    Every access, rotation, and policy change — recorded by Chronos.
  </Text>

  <Table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Action</th>
        <th>Secret</th>
        <th>Actor</th>
        <th>Result</th>
      </tr>
    </thead>
    <tbody>
      {#each entries as entry}
        <tr>
          <td><Text size="0.85rem">{entry.timestamp}</Text></td>
          <td><Text weight="600">{entry.action}</Text></td>
          <td><Text as="kbd">{entry.secret}</Text></td>
          <td><Text>{entry.actor}</Text></td>
          <td><Text>{entry.result}</Text></td>
        </tr>
      {/each}
    </tbody>
  </Table>
</Box>
