/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** FEATURE_SCORING, injected by vite.config.ts `define` (a boolean, not a string). */
  readonly VITE_FEATURE_SCORING: boolean;
}
