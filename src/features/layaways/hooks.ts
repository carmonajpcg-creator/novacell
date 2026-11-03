import { useQuery } from '@tanstack/react-query'
import { client } from '@/hooks/data'
import * as api from './api'

export const layawayKeys = {
  all: ['layaways'] as const,
  one: (id: string) => ['layaway', id] as const,
  bySale: (saleId: string) => ['layaway-by-sale', saleId] as const,
  payments: (saleId: string) => ['layaway-payments', saleId] as const,
  byCustomer: (customerId: string) => ['customer-layaways', customerId] as const,
}

export const useLayaways = () => useQuery({ queryKey: layawayKeys.all, queryFn: () => api.listLayaways(client()) })
export const useLayaway = (id: string) =>
  useQuery({ queryKey: layawayKeys.one(id), queryFn: () => api.getLayaway(client(), id) })
export const useLayawayBySale = (saleId: string) =>
  useQuery({ queryKey: layawayKeys.bySale(saleId), queryFn: () => api.getLayawayBySale(client(), saleId), enabled: saleId !== '' })
export const useLayawayPayments = (saleId: string) =>
  useQuery({ queryKey: layawayKeys.payments(saleId), queryFn: () => api.listLayawayPayments(client(), saleId), enabled: saleId !== '' })
export const useCustomerLayaways = (customerId: string) =>
  useQuery({ queryKey: layawayKeys.byCustomer(customerId), queryFn: () => api.listCustomerLayaways(client(), customerId) })
