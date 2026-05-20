/**
 * {{Plugin Name}} — pares-radix plugin
 *
 * This is your plugin entry point. Export the plugin lifecycle hooks
 * and register your action handlers here.
 */

import type { PluginContext, PluginLifecycle } from '@pares/radix-plugin';
import { handlers } from './handlers';

/**
 * Plugin lifecycle — called by pares-radix during registration.
 *
 * Available hooks:
 * - onLoad: called once when plugin is loaded (register handlers, load .px)
 * - onActivate: called when plugin is activated by user
 * - onDeactivate: called when plugin is deactivated
 * - onUnload: called when plugin is removed
 */
export const plugin: PluginLifecycle = {
  async onLoad(ctx: PluginContext) {
    // Register your action handlers — these are what .px procedures call
    for (const [name, handler] of Object.entries(handlers)) {
      ctx.registerAction(name, handler);
    }

    // .px files in the px/ directory are automatically compiled and
    // registered by pares-radix. You don't need to do anything here
    // for .px procedures to work — just drop .px files in px/.

    console.log(`[{{plugin-id}}] loaded`);
  },

  async onActivate(ctx: PluginContext) {
    // Plugin activated — start any background work, subscriptions, etc.
  },

  async onDeactivate(ctx: PluginContext) {
    // Plugin deactivated — clean up subscriptions, timers, etc.
  },
};

export default plugin;
