<script lang="ts">
  import { Box, Heading, Text, Button, Input, Table } from '@plures/design-dojo';

  interface Secret {
    id: string;
    name: string;
    category: string;
    lastRotated: string;
    expiresIn: string;
    tags: string[];
  }

   
  let secrets = $state<Secret[]>([
    { id: '1', name: 'GITHUB_PAT', category: 'API Key', lastRotated: '2d ago', expiresIn: '5d', tags: ['ci', 'github'] },
    { id: '2', name: 'ADO_PAT', category: 'API Key', lastRotated: '1d ago', expiresIn: '6d', tags: ['ci', 'azure'] },
    { id: '3', name: 'DB_PASSWORD', category: 'Password', lastRotated: '30d ago', expiresIn: 'Never', tags: ['database'] },
    { id: '4', name: 'SSH_PRIVATE_KEY', category: 'Key', lastRotated: '90d ago', expiresIn: 'Never', tags: ['ssh', 'deploy'] },
  ]);

   
  let searchQuery = $state('');
   
  let filtered = $derived(
    secrets.filter(s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.tags.some(t => t.includes(searchQuery.toLowerCase()))
    )
  );
</script>

<Box padding="24px" gap="20px">
  <Box direction="row" justify="space-between" align="center">
    <Heading level={1}>Secrets</Heading>
    <Button variant="primary">Add Secret</Button>
  </Box>

  <Input
    placeholder="Search secrets by name or tag..."
    bind:value={searchQuery}
    name="search"
  />

  <Table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Category</th>
        <th>Last Rotated</th>
        <th>Expires</th>
        <th>Tags</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each filtered as secret (secret.id)}
        <tr>
          <td><Text weight="600">{secret.name}</Text></td>
          <td><Text>{secret.category}</Text></td>
          <td><Text>{secret.lastRotated}</Text></td>
          <td><Text>{secret.expiresIn}</Text></td>
          <td>
            <Box direction="row" gap="4px">
              {#each secret.tags as tag}
                <Text as="kbd" size="0.75rem">{tag}</Text>
              {/each}
            </Box>
          </td>
          <td>
            <Box direction="row" gap="4px">
              <Button variant="ghost">View</Button>
              <Button variant="ghost">Rotate</Button>
            </Box>
          </td>
        </tr>
      {/each}
    </tbody>
  </Table>
</Box>
