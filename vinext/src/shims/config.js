// next/config: runtime config from next.config's serverRuntimeConfig and
// publicRuntimeConfig. The server sets it before rendering; the browser
// reads publicRuntimeConfig from __NEXT_DATA__.runtimeConfig.
let runtimeConfig = null;

export default function getConfig() {
  if (runtimeConfig) return runtimeConfig;
  if (typeof window !== "undefined" && window.__NEXT_DATA__) {
    return { serverRuntimeConfig: {}, publicRuntimeConfig: window.__NEXT_DATA__.runtimeConfig || {} };
  }
  return { serverRuntimeConfig: {}, publicRuntimeConfig: {} };
}

export function setConfig(configValue) {
  runtimeConfig = configValue;
}
