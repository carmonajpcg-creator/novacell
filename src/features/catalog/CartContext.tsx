import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { addLine, cartCount, cartTotalCents, parseStoredCart, removeLine, setQuantity, type CartLine } from './cart'

const STORAGE_KEY = 'novacell-cart-v1'

interface CartState {
  lines: CartLine[]
  count: number
  totalCents: number
  add: (line: CartLine) => void
  setQty: (key: string, quantity: number) => void
  remove: (key: string) => void
  replace: (lines: CartLine[]) => void
  clear: () => void
}

const CartContext = createContext<CartState | null>(null)

function load(): CartLine[] {
  try {
    return parseStoredCart(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(load)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
    } catch {
      /* almacenamiento no disponible: el carrito sigue funcionando en memoria */
    }
  }, [lines])

  const add = useCallback((line: CartLine) => setLines((ls) => addLine(ls, line)), [])
  const setQty = useCallback((key: string, q: number) => setLines((ls) => setQuantity(ls, key, q)), [])
  const remove = useCallback((key: string) => setLines((ls) => removeLine(ls, key)), [])
  const replace = useCallback((next: CartLine[]) => setLines(next), [])
  const clear = useCallback(() => setLines([]), [])

  const value = useMemo<CartState>(
    () => ({ lines, count: cartCount(lines), totalCents: cartTotalCents(lines), add, setQty, remove, replace, clear }),
    [lines, add, setQty, remove, replace, clear],
  )
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartState {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart debe usarse dentro de CartProvider')
  return ctx
}
