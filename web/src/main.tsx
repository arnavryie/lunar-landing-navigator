import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// A bare URL opens the front page; ?view=explorer opens the standalone 3D/2D Moon Explorer;
// any other query opens the planner directly. Each bundle is split so neither Cesium nor Three loads unnecessarily.
const params = new URLSearchParams(location.search)
const Page =
  params.get('view') === 'explorer'
    ? lazy(() => import('./explorer/MoonExplorer.tsx').then((m) => ({ default: m.MoonExplorer })))
    : location.search
      ? lazy(() => import('./App.tsx'))
      : lazy(() => import('./Landing.tsx').then((m) => ({ default: m.Landing })))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </StrictMode>,
)
