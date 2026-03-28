/**
 * Svelte module shim for TypeScript.
 *
 * Tells the TypeScript compiler that *.svelte files are valid modules so
 * that dynamic imports in plugin route definitions type-check without
 * requiring the individual component files to exist yet. The consuming
 * host (pares-radix / Tauri app) provides the full Svelte compiler and
 * type resolution at build time.
 */

declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component;
  export default component;
}
