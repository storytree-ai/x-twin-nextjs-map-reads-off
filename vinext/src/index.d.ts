import type { Plugin } from "vite";

export interface VinextOptions {
  /** Options passed to @vitejs/plugin-react. */
  react?: Record<string, unknown>;
}

export interface NextConfig {
  basePath?: string;
  trailingSlash?: boolean;
  env?: Record<string, string>;
  generateBuildId?: () => string | null | Promise<string | null>;
  redirects?: () => Promise<unknown[]>;
  rewrites?: () => Promise<unknown[] | { beforeFiles?: unknown[]; afterFiles?: unknown[]; fallback?: unknown[] }>;
  headers?: () => Promise<unknown[]>;
  serverRuntimeConfig?: Record<string, unknown>;
  publicRuntimeConfig?: Record<string, unknown>;
  [key: string]: unknown;
}

export function loadNextConfig(root: string, phase?: string): Promise<{ file: string | null; config: NextConfig }>;

export default function vinext(options?: VinextOptions): Plugin[];
