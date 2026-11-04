import type { SupabaseClient } from '@supabase/supabase-js'
import type { DashboardMetrics } from './types'

export async function fetchDashboard(c: SupabaseClient): Promise<DashboardMetrics> {
  const { data, error } = await c.rpc('dashboard_metrics')
  if (error) throw error
  return data as DashboardMetrics
}
