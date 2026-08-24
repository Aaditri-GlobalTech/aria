/// <reference types="vite/client" />

interface Window {
  electron: {
    ping: () => string;
    window: {
      close: () => void;
      minimize: () => void;
      toggleMaximize: () => void;
      onMaximizedChange: (listener: (maximized: boolean) => void) => () => void;
    };
  };
}
