import { useQuery } from '@tanstack/react-query'
import { client } from '@/hooks/data'
import * as api from './api'

export const creditKeys = {
  all: ['credits'] as const,
  one: (id: string) => ['credit', id] as const,
  bySale: (saleId: string) => ['credit-by-sale', saleId] as const,
  installments: (id: string) => ['credit-installments', id] as const,
  payments: (saleId: string) => ['credit-payments', saleId] as const,
  byCustomer: (customerId: string) => ['customer-credits', customerId] as const,
}

export const useCredits = () => useQuery({ queryKey: creditKeys.all, queryFn: () => api.listCredits(client()) })
export const useCredit = (id: string) =>
  useQuery({ queryKey: creditKeys.one(id), queryFn: () => api.getCredit(client(), id) })
export const useCreditBySale = (saleId: string) =>
  useQuery({ queryKey: creditKeys.bySale(saleId), queryFn: () => api.getCreditBySale(client(), saleId), enabled: saleId !== '' })
export const useInstallments = (creditId: string) =>
  useQuery({ queryKey: creditKeys.installments(creditId), queryFn: () => api.listInstallments(client(), creditId) })
export const useCreditPayments = (saleId: string) =>
  useQuery({ queryKey: creditKeys.payments(saleId), queryFn: () => api.listCreditPayments(client(), saleId), enabled: saleId !== '' })
export const useCustomerCredits = (customerId: string) =>
  useQuery({ queryKey: creditKeys.byCustomer(customerId), queryFn: () => api.listCustomerCredits(client(), customerId) })
export const usePaymentAllocations = (paymentId: string) =>
  useQuery({ queryKey: ['payment-allocations', paymentId], queryFn: () => api.listPaymentAllocations(client(), paymentId) })
export const useAllCreditPayments = () =>
  useQuery({ queryKey: ['credit-payments-all'], queryFn: () => api.listAllCreditPayments(client()) })