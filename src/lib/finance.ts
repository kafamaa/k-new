import type { SupabaseClient } from '@supabase/supabase-js'

export type ExpenseStatus = 'submitted' | 'approved' | 'rejected' | 'refunded'
export type PaymentStatus = 'proof_submitted' | 'under_review' | 'paid' | 'waived' | 'refunded' | 'rejected'
export type FinanceAccess = { organizationRole?: string; tournamentPermission?: string }

export function canManageFinance(access: FinanceAccess): boolean { return access.organizationRole === 'owner' || access.organizationRole === 'finance' || access.tournamentPermission === 'finance' }
export function financeStatusTransitionAllowed(from: ExpenseStatus, to: ExpenseStatus): boolean { if (from === to) return true; if (from === 'submitted') return ['approved', 'rejected'].includes(to); if (from === 'approved') return to === 'refunded'; return false }

export async function createExpense(client: SupabaseClient, organizationId: string, tournamentId: string | null, userId: string, category: string, description: string, amountMvr: number) {
  if (amountMvr <= 0 || !category.trim() || !description.trim()) return { data: null, error: 'Category, description, and a positive MVR amount are required.' }
  const result = await client.from('finance_expenses').insert({ organization_id: organizationId, tournament_id: tournamentId, category: category.trim(), description: description.trim(), amount_mvr: amountMvr, created_by: userId }).select('id,status').single()
  return { data: result.data, error: result.error?.message ?? null }
}

export async function updateExpenseStatus(client: SupabaseClient, expenseId: string, status: ExpenseStatus) { const result = await client.from('finance_expenses').update({ status, approved_at: status === 'approved' ? new Date().toISOString() : null }).eq('id', expenseId); return { error: result.error?.message ?? null } }
export async function recordAdjustment(client: SupabaseClient, paymentId: string, kind: 'waiver' | 'refund', amountMvr: number, reason: string, userId: string) { if (amountMvr <= 0 || !reason.trim()) return { data: null, error: 'A positive amount and reason are required.' }; const result = await client.from('finance_adjustments').insert({ payment_id: paymentId, kind, amount_mvr: amountMvr, reason: reason.trim(), approved_by: userId }).select('id').single(); return { data: result.data, error: result.error?.message ?? null } }
