/**
 * Action Handlers — the IO boundary for your .px procedures.
 *
 * Each handler is a function that receives (params: unknown) and returns
 * a result value. These are called when a .px procedure step references
 * the handler by name.
 *
 * Example .px usage:
 *   my_action {param1: $value, param2: "literal"} -> $result
 *
 * The handler named "my_action" receives { param1: ..., param2: "literal" }
 * and returns whatever $result should be.
 */

import type { ActionHandler } from '@pares/radix-plugin';

/**
 * Example action handler — replace with your actual handlers.
 */
const hello: ActionHandler = async (params: unknown) => {
  const { name } = params as { name: string };
  return { greeting: `Hello, ${name}!` };
};

/**
 * Export all handlers as a name → function map.
 * These names must match what your .px procedures call.
 */
export const handlers: Record<string, ActionHandler> = {
  hello,
  // Add your handlers here:
  // fetch_data,
  // send_notification,
  // query_api,
};
