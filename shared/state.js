// Shared state management utilities
// Extracted from worker.js and generate_worker.mjs to eliminate duplication.

export async function saveState(chatId, state, env) {
  await env.REMINDERS.put(`user:${chatId}:state`, JSON.stringify(state));
}

export async function resetState(chatId, env) {
  await env.REMINDERS.delete(`user:${chatId}:state`);
}

export function cryptoRandomId(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  for (let i = 0; i < len; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}
