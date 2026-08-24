import { Button } from "@kobalte/core/button";
import { createSignal } from "solid-js";

export const APP_NAME = "Aria";

export default function App() {
  const [count, setCount] = createSignal(0);

  return (
    <main class="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
      <section class="space-y-6 text-center">
        <p class="text-sm uppercase tracking-[0.3em] text-cyan-300">
          Electron + Solid
        </p>
        <h1 class="text-5xl font-semibold">{APP_NAME}</h1>
        <Button
          class="rounded-lg bg-cyan-400 px-4 py-2 font-medium text-slate-950 hover:bg-cyan-300"
          onClick={() => setCount((value) => value + 1)}
        >
          Clicked {count()} times
        </Button>
      </section>
    </main>
  );
}
