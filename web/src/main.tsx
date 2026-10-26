import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { usePrefs } from './lib/store'
import './styles/fonts.css'
import './styles/base.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 本机接口很快：切回页面时先显示缓存，再静默刷新
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})

function Root() {
  const reduced = usePrefs((p) => p.motion === 'reduced')
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <App />
    </MotionConfig>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </StrictMode>,
)
