import { registerSite, type Site } from './data'

// A small pool of Web Workers so many points (the landing-ellipse samples) run in parallel; a single map click uses one.
// Each worker loads the terrain (~13 MB) once, so the pool is capped.
const POOL = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
const workers: { w: Worker; busy: number }[] = []
let nextId = 0
const pending = new Map<number, { resolve: (s: Site) => void; reject: (e: Error) => void; slot: { busy: number } }>()

function spawn() {
  const slot = { w: new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }), busy: 0 }
  slot.w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; site?: Site; error?: string }>) => {
    const p = pending.get(e.data.id)
    pending.delete(e.data.id)
    if (p) p.slot.busy--
    if (e.data.ok && e.data.site) p?.resolve(e.data.site)
    else p?.reject(new Error(e.data.error))
  }
  workers.push(slot)
  return slot
}

/** Compute a point (85-90 S) exactly in a Web Worker. By default it becomes site id 'custom';
 *  register = false only returns it (the F7 finder and the landing ellipse use that). */
export function computeCustomPoint(lat: number, lon: number, register = true): Promise<Site> {
  let slot = workers.reduce<(typeof workers)[number] | undefined>((a, b) => (!a || b.busy < a.busy ? b : a), undefined)
  if ((!slot || slot.busy > 0) && workers.length < POOL) slot = spawn()
  slot!.busy++
  const id = nextId++
  const result = new Promise<Site>((resolve, reject) => pending.set(id, { resolve, reject, slot: slot! }))
  slot!.w.postMessage({ id, lat, lon })
  return register ? result.then((s) => (registerSite(s), s)) : result
}
