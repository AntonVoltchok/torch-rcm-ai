/**
 * What the shell draws around a screen, declared by the route (`staticData.chrome`) and read from the leaf match.
 *  - `header`: `full` is the whose-move cards + the to-scale pipeline card (the Inbox); `slim` is the one-line
 *    pipeline; `none` draws neither.
 *  - `panel`: wrap the screen in one white panel on the canvas (the scroll container). A screen that draws its own
 *    panels (D1's Inbox split, the claim cards) sets `panel: false` and owns its padding.
 * Default: `{ header: 'slim', panel: true }`. Red-teamed in docs/design/red-team/challenge-d1-shell-2026-11-08.md.
 */
import { useMatches } from '@tanstack/react-router'

export interface Chrome {
  header: 'full' | 'slim' | 'none'
  panel: boolean
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    chrome?: Partial<Chrome>
  }
}

export const DEFAULT_CHROME: Chrome = { header: 'slim', panel: true }

export function useChrome(): Chrome {
  const leaf = useMatches({ select: (ms) => ms.at(-1)?.staticData.chrome })
  return { ...DEFAULT_CHROME, ...leaf }
}
