import { render } from "solid-js/web";
import App from "./App";
import "./index.css";

// The HTML shell must provide exactly one mount point for the Solid app.
const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

render(() => <App />, root);
