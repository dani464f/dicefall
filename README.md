# Dicefall

A premium, mobile-first tabletop dice roller that uses real physics so the number you see is the face the die actually lands on.

**🎲 Live demo: <https://dicefall-steel.vercel.app>** — best on a phone

> Generic tabletop RPG dice. Not affiliated with Dungeons & Dragons or any other trademark holder.

## Status

- D4, D6, D8, D10, D12, D20, D100 — all **physics-driven**: the scene throws the die, watches it settle, reads the upward face.
- Each face shows its actual numeral painted on, matching what face-detection will read.
- Proficiency bonus pill (0–6), added on top of every roll.
- Presets and roll history persist to `localStorage`.
- Settings: reduced motion (auto / animated / reduced), sound + haptics placeholders.

## Run locally

```bash
npm install
npm run dev
```

Open the printed URL (usually `http://localhost:5173`). The app is mobile-first — use your browser's device toolbar to see it at phone width.

## Build

```bash
npm run build
npm run preview
```

The production build outputs to `dist/`.

## Deploy to Vercel

A `vercel.json` is included with SPA rewrites and a `Cache-Control` header for the Rapier WASM payload.

```bash
npx vercel
```

Or push to GitHub and import the repo at <https://vercel.com/new>.

## Tech

- React 19 + TypeScript + Vite
- Tailwind CSS v4 (CSS-first theme tokens — see `src/index.css`)
- three.js (vanilla — React Three Fiber currently fails to initialize on React 19.2 in this build; we may revisit)
- `@dimforge/rapier3d-compat` for physics (WASM)

## Project layout

```
src/
  components/
    DiceScene.tsx        ← three.js renderer + Rapier physics + face detection
    DiceTray.tsx         ← stacked 3D canvas + 2D result overlay
    DiceSelector.tsx     ← D4..D100 grid
    RollControls.tsx     ← quantity / modifier steppers
    ResultPanel.tsx      ← total / chips / awaiting-roll
    Sheet.tsx            ← reusable bottom-drawer
    PresetsPanel.tsx
    RollHistory.tsx
    SettingsPanel.tsx
  hooks/
    useDiceRoller.ts     ← physics throw flow + legacy RNG flow
    useLocalStorage.ts
  lib/
    dice.ts              ← rollDice (fair RNG, used as fallback)
    physics.ts           ← Rapier loader
    faceDetection.ts     ← per-die-type face-normal tables + upward-face lookup
    diceFaceTextures.ts  ← D6 pip textures
    valueSprite.ts       ← floating value labels for D4/D8/D12/D20
  types/dice.ts
  App.tsx
  main.tsx
  index.css
```

## License

Personal project. Not licensed for redistribution.
