import { useQuery } from '@tanstack/react-query'
import { client } from '@/hooks/data'
import * as api from './api'
import type { QueueItem } from './types'

export const collectionKeys = {
  queue: ['collection-queue'] as const,
  reminders: (kind: string, refId: string) => ['collection-reminders', kind, refId] as const,
}

export const useCollectionQueue = () =>
  useQuery({ queryKey: collectionKeys.queue, queryFn: () => api.listQueue(client()) })

export const useItemReminders = (item: Pick<QueueItem, 'kind' | 'ref_id'>) =>
  useQuery({
    queryKey: collectionKeys.reminders(item.kind, item.ref_id),
    queryFn: () => api.listReminders(client(), item),
  })
