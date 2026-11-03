export type ProductKind = 'iphone' | 'accessory'
export type UnitStatus = 'available' | 'reserved' | 'sold' | 'inactive'
export type UnitCondition = 'new' | 'used'
export type MovementType = 'entry' | 'exit' | 'adjustment'

export interface Category {
  id: string
  name: string
  slug: string
  kind: ProductKind
  sort_order: number
  is_active: boolean
}

export interface Product {
  id: string
  category_id: string
  kind: ProductKind
  name: string
  slug: string
  description: string | null
  is_published: boolean
  is_active: boolean
  category?: { name: string } | null
}

export interface ProductVariant {
  id: string
  product_id: string
  sku: string
  color: string | null
  compatible_model: string | null
  price: number
  cost: number
  stock_quantity: number
  is_active: boolean
}

export interface ProductUnit {
  id: string
  internal_code: string
  product_id: string
  imei: string
  serial_number: string | null
  storage_gb: number
  color: string
  condition: UnitCondition
  physical_grade: string | null
  battery_health: number | null
  status: UnitStatus
  acquisition_cost: number
  sale_price: number
  notes: string | null
  created_at: string
  product?: { name: string } | null
}

export interface InventoryMovement {
  id: string
  movement_type: MovementType
  quantity_delta: number
  stock_after: number | null
  reason: string | null
  created_at: string
  unit?: { internal_code: string; product: { name: string } | null } | null
  variant?: { sku: string; product: { name: string } | null } | null
}

export interface ProductImage {
  id: string
  product_id: string
  product_unit_id: string | null
  storage_path: string
  alt_text: string | null
  sort_order: number
  is_primary: boolean
}

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  available: 'Disponible',
  reserved: 'Reservada',
  sold: 'Vendida',
  inactive: 'Inactiva',
}

export const CONDITION_LABEL: Record<UnitCondition, string> = {
  new: 'Nuevo',
  used: 'Seminuevo',
}

export const KIND_LABEL: Record<ProductKind, string> = {
  iphone: 'iPhone',
  accessory: 'Accesorio',
}

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  entry: 'Entrada',
  exit: 'Salida',
  adjustment: 'Ajuste',
}
