import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/features/auth'
import { CartProvider } from '@/features/catalog'
import { AppRoutes } from './router'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* HashRouter: compatible con GitHub Pages (enlaces profundos y recargas). */}
        <CartProvider>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </CartProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
