import { useQuery } from '@tanstack/react-query'
import { client } from '@/hooks/data'
import * as api from './api'

export const deliveryKeys = {
  all: ['deliveries'] as const,
  one: (id: string) => ['delivery', id] as const,
  bySale: (saleId: string) => ['delivery-by-sale', saleId] as const,
  confirmedSales: ['confirmed-sales'] as const,
}

export const useDeliveries = () => useQuery({ queryKey: deliveryKeys.all, queryFn: () => api.listDeliveries(client()) })
export const useDelivery = (id: string) =>
  useQuery({ queryKey: deliveryKeys.one(id), queryFn: () => api.getDelivery(client(), id) })
export const useActiveDeliveryBySale = (saleId: string) =>
  useQuery({
    queryKey: deliveryKeys.bySale(saleId),
    queryFn: () => api.getActiveDeliveryBySale(client(), saleId),
    enabled: saleId !== '',
  })
export const useConfirmedSales = () =>
  useQuery({ queryKey: deliveryKeys.confirmedSales, queryFn: () => api.listConfirmedSales(client()) })
