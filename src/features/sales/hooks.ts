import { useQuery } from '@tanstack/react-query'
import { client } from '@/hooks/data'
import * as api from './api'

export const saleKeys = {
  all: ['sales'] as const,
  one: (id: string) => ['sale', id] as const,
  items: (id: string) => ['sale-items', id] as const,
  payments: (id: string) => ['sale-payments', id] as const,
  byCustomer: (customerId: string) => ['customer-sales', customerId] as const,
  sellableVariants: ['sellable-variants'] as const,
}

export const useSales = () => useQuery({ queryKey: saleKeys.all, queryFn: () => api.listSales(client()) })
export const useSale = (id: string) =>
  useQuery({ queryKey: saleKeys.one(id), queryFn: () => api.getSale(client(), id) })
export const useSaleItems = (id: string) =>
  useQuery({ queryKey: saleKeys.items(id), queryFn: () => api.listSaleItems(client(), id) })
export const usePayments = (id: string) =>
  useQuery({ queryKey: saleKeys.payments(id), queryFn: () => api.listPayments(client(), id) })
export const useCustomerSales = (customerId: string) =>
  useQuery({ queryKey: saleKeys.byCustomer(customerId), queryFn: () => api.listCustomerSales(client(), customerId) })
export const useSellableVariants = () =>
  useQuery({ queryKey: saleKeys.sellableVariants, queryFn: () => api.listSellableVariants(client()) })
