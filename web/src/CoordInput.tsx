import { useState } from 'react'
import { parseCoords } from './coords'

export function CoordInput({ onGo, busy, error }: { onGo: (lat: number, lon: number) => void; busy: boolean; error: string }) {
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [msg, setMsg] = useState('')
  return (
    <form
      className="coord-pick"
      aria-label="Go to coordinates"
      onSubmit={(e) => {
        e.preventDefault()
        const r = parseCoords(lat, lon)
        if (typeof r === 'string') return setMsg(r)
        setMsg('')
        onGo(r.lat, r.lon)
      }}
    >
      <label>
        <span>Lat °S</span>
        <input inputMode="decimal" placeholder="89.45" value={lat} onChange={(e) => setLat(e.target.value)} aria-label="Latitude, degrees south (85 to 90)" />
      </label>
      <label>
        <span>Lon °E</span>
        <input inputMode="decimal" placeholder="222.7" value={lon} onChange={(e) => setLon(e.target.value)} aria-label="Longitude, degrees east (or add W)" />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Computing' : 'Go'}
      </button>
      {(msg || error) && (
        <p className="coord-msg" role="alert">
          {msg || error}
        </p>
      )}
    </form>
  )
}
