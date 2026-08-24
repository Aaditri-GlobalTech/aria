import { Button } from "@kobalte/core/button";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

const [count] = createSignal(0);

console.log(Button, render, count());
