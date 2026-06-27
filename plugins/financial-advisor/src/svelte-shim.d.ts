/**
 * Ambient module declaration for `*.svelte` imports.
 *
 * The pares-modulus repo's canonical type-check runs inside the full Svelte
 * toolchain (svelte-check / the SvelteKit tsconfig), which teaches TypeScript
 * how to resolve `*.svelte` modules. This plugin-local, isolated `tsc --noEmit`
 * (used because the monorepo root has no installed node_modules) lacks that
 * toolchain, so the dynamic `import('./pages/Foo.svelte')` calls in index.ts
 * would otherwise raise TS2307. This shim resolves `*.svelte` specifiers to a
 * generic component module so the isolated type-check exercises the real `.ts`
 * sources (migrate.ts, parsers, rules, tests) without false negatives.
 *
 * It affects ONLY local type-checking and ships no runtime behavior.
 */
declare module '*.svelte' {
  const component: unknown;
  export default component;
}
