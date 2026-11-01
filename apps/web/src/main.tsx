import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { USE_MOCKS } from '@/env'
import { createAppRouter, createQueryClient } from './router'
import './styles.css'

async function boot() {
  if (USE_MOCKS) {
    const { startMockWorker } = await import('@/mocks/browser')
    await startMockWorker()
  }
  const queryClient = createQueryClient()
  const router = createAppRouter(queryClient)
  const root = document.getElementById('root')
  if (!root) throw new Error('#root missing')
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void boot()
