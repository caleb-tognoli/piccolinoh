// Public API for the watchtogether module.
//
// Consumers (this repo's Discord bot, the web client, external services)
// interact with the module exclusively through the symbols exported here.
// Nothing outside this folder should reach into ./boot, ./store, etc. directly.

export { startServer } from "./boot.js";
export {
  createSessionInStore as createSession,
  getSession,
  destroySession,
} from "./store.js";
export type {
  Session,
  SerializedSession,
  QueueItem,
  CurrentTrack,
  SessionSettings,
} from "./session.js";
