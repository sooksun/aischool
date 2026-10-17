/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** FEATURE_SCORING, injected by vite.config.ts `define` (a boolean, not a string). */
  readonly VITE_FEATURE_SCORING: boolean;
  /** Web sign-in through Keycloak is available (CCR-018); from vite.config.ts. */
  readonly VITE_WEB_SSO: boolean;
}
