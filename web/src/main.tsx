import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// A bare URL opens the front page; any query (a permalink, ?view=…) opens the planner directly.
// Both are split so the planner doesn't load three.js up front, and the front page doesn't load the planner.
const Page = location.search
  ? lazy(() => import('./App.tsx'))
  : lazy(() => import('./Landing.tsx').then((m) => ({ default: m.Landing })))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </StrictMode>,
)
