// Public API for the watchtogether module.
//
// Consumers (this repo's Discord bot, the web client, external services)
// interact with the module exclusively through the symbols exported here.
// Nothing outside this folder should reach into ./boot, ./store, etc. directly.

export { startServer } from "./boot.js";
export {
  getSession,
  destroySession,
  getOrCreateSessionForGuild,
  setSettingsLoader,
  updateSessionSettingsForGuild,
} from "./store.js";
export type {
  Session,
  SerializedSession,
  QueueItem,
  CurrentTrack,
  SessionSettings,
} from "./session.js";
export { serializeForClient } from "./session.js";
export { applyControl, handlePlaybackError } from "./control.js";
export { subscribeToSession } from "./events.js";
export { setJoinTokenVerifier } from "./ws.js";
export type { JoinTokenVerifier } from "./ws.js";
export type { ControlAction } from "./protocol.js";
