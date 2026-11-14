import { registerSite, type Site } from './data'

let worker: Worker | null = null

/** Compute a custom point (85-90 S) in a Web Worker and register it as site id 'custom'. */
export function computeCustomPoint(lat: number, lon: number): Promise<Site> {
  worker ??= new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<{ ok: boolean; site?: Site; error?: string }>) => {
      if (e.data.ok && e.data.site) {
        registerSite(e.data.site)
        resolve(e.data.site)
      } else reject(new Error(e.data.error))
    }
    w.postMessage({ lat, lon })
  })
}
