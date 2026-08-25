/// <reference types="vite/client" />

import type { AriaApi } from "./api";

declare global {
  interface Window {
    aria: AriaApi;
  }
}
