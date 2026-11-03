import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhone, type CustomerValues } from './schemas'
import type { Customer } from './types'

async function unwrap<T = unknown>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await promise
  if (error) throw error
  return data as T
}

function toRow(v: CustomerValues) {
  const phone = normalizePhone(v.phone)
  const notes = (v.notes ?? '').trim()
  return {
    name: v.name,
    phone: phone === '' ? null : phone,
    contact_method: v.contact_method,
    acquisition_source: v.acquisition_source,
    notes: notes === '' ? null : notes,
  }
}

export const listCustomers = (c: SupabaseClient) =>
  unwrap<Customer[]>(c.from('customers').select('*').order('name'))

export const getCustomer = (c: SupabaseClient, id: string) =>
  unwrap<Customer>(c.from('customers').select('*').eq('id', id).single())

export const createCustomer = (c: SupabaseClient, v: CustomerValues) =>
  unwrap<Customer>(c.from('customers').insert(toRow(v)).select().single())

export const updateCustomer = (c: SupabaseClient, id: string, v: CustomerValues) =>
  unwrap<Customer>(c.from('customers').update(toRow(v)).eq('id', id).select().single())

export const setCustomerActive = (c: SupabaseClient, id: string, is_active: boolean) =>
  unwrap<Customer>(c.from('customers').update({ is_active }).eq('id', id).select().single())

export const deleteCustomer = (c: SupabaseClient, id: string) =>
  unwrap(c.from('customers').delete().eq('id', id))
