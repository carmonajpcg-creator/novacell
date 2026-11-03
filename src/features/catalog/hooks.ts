import { useQuery } from '@tanstack/react-query'
import { client } from '@/hooks/data'
import { fetchBusinessInfo, fetchCatalog, publicImageUrl } from './api'

export const useCatalog = () =>
  useQuery({ queryKey: ['public-catalog'], queryFn: () => fetchCatalog(client()), staleTime: 60_000 })

export const useBusinessInfo = () =>
  useQuery({ queryKey: ['public-business-info'], queryFn: () => fetchBusinessInfo(client()), staleTime: 60_000 })

export const imageUrl = (path: string) => publicImageUrl(client(), path)
