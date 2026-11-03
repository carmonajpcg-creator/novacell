/**
 * Tipos de lo que el visitante puede ver. Corresponden a las vistas públicas `public_*` de la base de datos:
 * por diseño no existen aquí IMEI, número de serie, costos, notas internas ni existencias exactas.
 */
export type ProductKind = 'iphone' | 'accessory'
export type UnitCondition = 'new' | 'used'
export type Availability = 'available' | 'low' | 'out'

export interface PublicCategory {
  id: string
  name: string
  slug: string
  kind: ProductKind
  sort_order: number
}

export interface PublicProduct {
  id: string
  category_id: string
  kind: ProductKind
  name: string
  slug: string
  description: string | null
  created_at: string
  price_from: number | null
  price_to: number | null
  available_count: number
  primary_image_path: string | null
}

export interface PublicUnit {
  public_code: string
  product_id: string
  storage_gb: number
  color: string
  condition: UnitCondition
  battery_health: number | null
  physical_grade: string | null
  price: number
}

export interface PublicVariant {
  id: string
  product_id: string
  sku: string
  color: string | null
  compatible_model: string | null
  price: number
  availability: Availability
}

export interface PublicImage {
  id: string
  product_id: string
  unit_code: string | null
  storage_path: string
  alt_text: string | null
  sort_order: number
  is_primary: boolean
}

export interface Catalog {
  categories: PublicCategory[]
  products: PublicProduct[]
  units: PublicUnit[]
  variants: PublicVariant[]
  images: PublicImage[]
}

export interface BusinessInfo {
  whatsapp_number?: string
  business_name?: string
  business_hours?: string
  business_address?: string
  delivery_info?: string
}

export const CONDITION_LABEL: Record<UnitCondition, string> = { new: 'Nuevo', used: 'Seminuevo' }
export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: 'Disponible',
  low: 'Pocas piezas',
  out: 'Agotado',
}

/** Máximo que se permite pedir por variante (la cantidad real se confirma por WhatsApp). */
export const MAX_QUANTITY: Record<Availability, number> = { available: 10, low: 3, out: 0 }
