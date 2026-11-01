import { Outlet } from '@tanstack/react-router'
import { useFirehose } from '@/hooks/useFirehose'
import { OutageBanner } from '@/components/OutageBanner'
import { Toaster } from '@/components/ui/Toaster'
import { Sidebar } from './Sidebar'

export function RootLayout() {
  useFirehose()
  return (
    <div className="flex h-full min-w-[1280px]">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <OutageBanner />
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}
