import { contextBridge, ipcRenderer } from 'electron'

// Handlers resolve with { ok, value } | { ok, error } so the structured error
// `kind` survives the contextBridge boundary. `import type` is erased at build,
// so this shares main.ts's declaration without pulling its runtime in.
import type { Envelope } from './main'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (res.ok) return res.value
  // Reject with a plain object so `kind` is preserved (Error subclasses lose
  // custom fields when cloned across worlds).
  return Promise.reject(res.error)
}

// Shape matches CodeburnBridge (app/renderer/lib/types.ts); typing is enforced
// renderer-side where `window.codeburn` is declared as CodeburnBridge.
const bridge = {
  getOverview: (period: string, provider: string) => invoke('codeburn:getOverview', period, provider),
  getPlans: (period: string) => invoke('codeburn:getPlans', period),
  getActReport: () => invoke('codeburn:getActReport'),
  getModels: (period: string, provider: string, byTask: boolean) => invoke('codeburn:getModels', period, provider, byTask),
  getYield: (period: string) => invoke('codeburn:getYield', period),
  getSpendFlow: (period: string, provider: string) => invoke('codeburn:getSpendFlow', period, provider),
  getDevices: (period: string) => invoke('codeburn:getDevices', period),
  getDevicesScan: () => invoke('codeburn:getDevicesScan'),
  getShareStatus: () => invoke('codeburn:getShareStatus'),
  getIdentity: () => invoke('codeburn:getIdentity'),
  cliStatus: () => invoke('codeburn:cliStatus'),
}

contextBridge.exposeInMainWorld('codeburn', bridge)
