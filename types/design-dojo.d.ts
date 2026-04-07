/**
 * Local type declarations for @plures/design-dojo.
 *
 * These mirror the public component surface used by pares-modulus plugins so
 * that type-checking and linting work in CI without requiring the (unpublished)
 * runtime package as a dependency.
 *
 * Each exported symbol is a Svelte component that replaces its raw HTML
 * counterpart:
 *   Button  → <button>
 *   Input   → <input>
 *   Select  → <select>
 *   Dialog  → <dialog>
 *   Table   → <table>
 */

import type { SvelteComponent } from 'svelte';

/** Design-system button — replaces raw `<button>`. */
export declare class Button extends SvelteComponent {}

/** Design-system text / number / date / file input — replaces raw `<input>`. */
export declare class Input extends SvelteComponent {}

/** Design-system select dropdown — replaces raw `<select>`. */
export declare class Select extends SvelteComponent {}

/** Design-system modal dialog — replaces raw `<dialog>`. */
export declare class Dialog extends SvelteComponent {}

/** Design-system data table — replaces raw `<table>`. */
export declare class Table extends SvelteComponent {}
