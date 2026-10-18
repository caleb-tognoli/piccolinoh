import { render } from "preact";
import { JoinScreen } from "./JoinScreen";
import { SessionView } from "./SessionView";
import { session } from "./store";
import "./style.css";

function App() {
  return session.value ? <SessionView /> : <JoinScreen />;
}

render(<App />, document.getElementById("app")!);
