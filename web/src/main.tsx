import { render } from "preact";
import { App } from "./App";
import "./style.css";

const root = document.getElementById("app");
if (!root) throw new Error("no #app element");
render(<App />, root);
