export type ContactMethod = 'whatsapp' | 'phone' | 'facebook' | 'in_person' | 'other'
export type AcquisitionSource = 'facebook' | 'whatsapp' | 'in_person' | 'other'

export interface Customer {
  id: string
  name: string
  phone: string | null
  contact_method: ContactMethod
  acquisition_source: AcquisitionSource
  notes: string | null
  is_active: boolean
  created_at: string
}

export const CONTACT_METHOD_LABEL: Record<ContactMethod, string> = {
  whatsapp: 'WhatsApp',
  phone: 'Llamada',
  facebook: 'Facebook',
  in_person: 'Presencial',
  other: 'Otro',
}

export const SOURCE_LABEL: Record<AcquisitionSource, string> = {
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  in_person: 'Presencial',
  other: 'Otros',
}
