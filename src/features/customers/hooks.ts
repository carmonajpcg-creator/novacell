import { useQuery } from '@tanstack/react-query'
import { client } from '@/hooks/data'
import * as api from './api'

export const customerKeys = {
  all: ['customers'] as const,
  one: (id: string) => ['customer', id] as const,
}

export const useCustomers = () =>
  useQuery({ queryKey: customerKeys.all, queryFn: () => api.listCustomers(client()) })

export const useCustomer = (id: string) =>
  useQuery({ queryKey: customerKeys.one(id), queryFn: () => api.getCustomer(client(), id) })
