import { Outlet } from '@tanstack/react-router'
import { useFirehose } from '@/hooks/useFirehose'
import { Toaster } from '@/components/ui/Toaster'
import { cn } from '@/lib/cn'
import { Sidebar } from './Sidebar'
import { ShellHeader } from './ShellHeader'
import { useChrome } from './chrome'
import { TourLayer } from '@/features/tour/TourLayer'
import { TourProvider, useTourOpen } from '@/features/tour/TourProvider'

/**
 * D1's frame: white sidebar, grey canvas, the route's header (chrome.ts), then the screen. By default the screen
 * sits in one white panel that is its scroll container; a route with `chrome.panel: false` draws its own panels.
 */
export function RootLayout() {
  useFirehose()
  return (
    <TourProvider>
      <Shell />
    </TourProvider>
  )
}

/** While a tour is up the shell is `inert` (no focus, clicks or shortcuts reach it); the toasts stay live outside it. */
function Shell() {
  const chrome = useChrome()
  const touring = useTourOpen()
  return (
    <>
    <div id="app-shell" className="flex h-full min-w-[1280px] bg-canvas" inert={touring}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-act px-3 py-2 font-semibold text-white focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <ShellHeader header={chrome.header} />
        <main
          id="main"
          tabIndex={-1}
          className={cn('flex min-h-0 min-w-0 flex-1 flex-col outline-none', chrome.panel && 'panel mx-4 mb-4 overflow-auto', !chrome.panel && chrome.header === 'none' && 'pt-3.5')}
        >
          <Outlet />
        </main>
      </div>
    </div>
    <TourLayer />
    <Toaster />
    </>
  )
}
