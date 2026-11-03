import {
  LayoutDashboard,
  Smartphone,
  Boxes,
  Users,
  Receipt,
  CreditCard,
  Bookmark,
  Wallet,
  BellRing,
  Truck,
  BarChart3,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export interface AdminNavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

/** Secciones del panel (CLAUDE.md §14). */
export const adminNav: AdminNavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/productos', label: 'Productos', icon: Smartphone },
  { to: '/admin/inventario', label: 'Inventario', icon: Boxes },
  { to: '/admin/clientes', label: 'Clientes', icon: Users },
  { to: '/admin/ventas', label: 'Ventas', icon: Receipt },
  { to: '/admin/creditos', label: 'Créditos', icon: CreditCard },
  { to: '/admin/apartados', label: 'Apartados', icon: Bookmark },
  { to: '/admin/abonos', label: 'Abonos', icon: Wallet },
  { to: '/admin/cobranza', label: 'Cobranza', icon: BellRing },
  { to: '/admin/entregas', label: 'Entregas', icon: Truck },
  { to: '/admin/reportes', label: 'Reportes', icon: BarChart3 },
  { to: '/admin/configuracion', label: 'Configuración', icon: Settings },
]
