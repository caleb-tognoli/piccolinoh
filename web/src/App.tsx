import { JoinScreen } from "./join/JoinScreen";
import { SessionView } from "./session/SessionView";
import { phase } from "./state/store";

export function App() {
  return phase.value === "join" ? <JoinScreen /> : <SessionView />;
}
