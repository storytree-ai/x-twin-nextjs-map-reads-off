// next/config: runtime config from next.config's serverRuntimeConfig and
// publicRuntimeConfig.
let runtimeConfig = { serverRuntimeConfig: {}, publicRuntimeConfig: {} };

export default function getConfig() {
  return runtimeConfig;
}

export function setConfig(configValue) {
  runtimeConfig = configValue;
}
