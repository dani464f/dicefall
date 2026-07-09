import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Cinzel — the display face (wordmark, numerals, Roll button, section
// labels). Self-hosted via @fontsource so there is no external font
// request; three weights cover label (400), numeral (600), and the Roll
// button / wordmark (700). Latin subset woff2 ≈ 12 KB per weight.
import '@fontsource/cinzel/400.css'
import '@fontsource/cinzel/600.css'
import '@fontsource/cinzel/700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
