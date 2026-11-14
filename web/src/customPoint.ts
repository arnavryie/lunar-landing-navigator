import { registerSite, type Site } from './data'

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: (s: Site) => void; reject: (e: Error) => void }>()

/** Compute a point (85-90 S) exactly in a Web Worker. By default it becomes site id 'custom';
 *  register = false only returns it (the F7 finder uses that to check its shortlist). */
export function computeCustomPoint(lat: number, lon: number, register = true): Promise<Site> {
  worker ??= Object.assign(new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }), {
    onmessage: (e: MessageEvent<{ id: number; ok: boolean; site?: Site; error?: string }>) => {
      const p = pending.get(e.data.id)
      pending.delete(e.data.id)
      if (e.data.ok && e.data.site) p?.resolve(e.data.site)
      else p?.reject(new Error(e.data.error))
    },
  })
  const id = nextId++
  const result = new Promise<Site>((resolve, reject) => pending.set(id, { resolve, reject }))
  worker.postMessage({ id, lat, lon })
  return register ? result.then((s) => (registerSite(s), s)) : result
}
