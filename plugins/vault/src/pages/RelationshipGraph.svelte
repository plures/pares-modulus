<script lang="ts">
  import { Box, Heading, Text } from '@plures/design-dojo';
</script>

<Box padding="24px" gap="20px">
  <Heading level={1}>Secret Relationships</Heading>
  <Text as="p" color="var(--color-text-muted)">
    Visualize how secrets depend on each other. See blast radius before rotating.
  </Text>

  <Box padding="40px" align="center" gap="12px">
    <Text size="3rem">🕸️</Text>
    <Text as="p">
      Graph visualization will render here using PluresDB relationship queries.
    </Text>
    <Text as="p" size="0.85rem" color="var(--color-text-muted)">
      Example: GITHUB_PAT → CI Pipeline → Deploy Workflow → Production
    </Text>
  </Box>
</Box>
