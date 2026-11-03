import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BusinessInfo,
  Catalog,
  PublicCategory,
  PublicImage,
  PublicProduct,
  PublicUnit,
  PublicVariant,
} from './types'

async function unwrap<T>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await promise
  if (error) throw error
  return data as T
}

// Columnas explícitas: nunca `select *`. Así una columna futura en la vista no llega al navegador por accidente.
export async function fetchCatalog(c: SupabaseClient): Promise<Catalog> {
  const [categories, products, units, variants, images] = await Promise.all([
    unwrap<PublicCategory[]>(c.from('public_categories').select('id,name,slug,kind,sort_order').order('sort_order').order('name')),
    unwrap<PublicProduct[]>(
      c
        .from('public_products')
        .select('id,category_id,kind,name,slug,description,created_at,price_from,price_to,available_count,primary_image_path')
        .order('name')
        .limit(500),
    ),
    unwrap<PublicUnit[]>(
      c
        .from('public_units')
        .select('public_code,product_id,storage_gb,color,condition,battery_health,physical_grade,price')
        .limit(2000),
    ),
    unwrap<PublicVariant[]>(
      c.from('public_variants').select('id,product_id,sku,color,compatible_model,price,availability').limit(2000),
    ),
    unwrap<PublicImage[]>(
      c
        .from('public_images')
        .select('id,product_id,unit_code,storage_path,alt_text,sort_order,is_primary')
        .order('sort_order')
        .limit(3000),
    ),
  ])
  return { categories, products, units, variants, images }
}

const INFO_KEYS = ['whatsapp_number', 'business_name', 'business_hours', 'business_address', 'delivery_info'] as const

export async function fetchBusinessInfo(c: SupabaseClient): Promise<BusinessInfo> {
  const rows = await unwrap<{ key: string; value: unknown }[]>(
    c.from('business_settings').select('key,value').eq('is_public', true).in('key', [...INFO_KEYS]),
  )
  const info: BusinessInfo = {}
  for (const row of rows) {
    if (typeof row.value === 'string' && row.value.trim() !== '' && (INFO_KEYS as readonly string[]).includes(row.key)) {
      info[row.key as keyof BusinessInfo] = row.value
    }
  }
  return info
}

export const publicImageUrl = (c: SupabaseClient, path: string) =>
  c.storage.from('product-images').getPublicUrl(path).data.publicUrl
