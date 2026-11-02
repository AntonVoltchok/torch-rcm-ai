/**
 * The JSON side of the contract. The mock server writes what Pydantic would send and the client's parse reads it,
 * so its records are typed with `z.input`: fields with a schema default may be left out of a fixture.
 */
import type { z } from 'zod'
import type * as S from '@/api/schema'

export type * from '@/api/schema'

export type AckEvent = z.input<typeof S.AckEvent>
export type ClaimDetail = z.input<typeof S.ClaimDetail>
export type ClaimRow = z.input<typeof S.ClaimRow>
export type EventFired = z.input<typeof S.EventFired>
export type Evidence = z.input<typeof S.Evidence>
export type HeldRow = z.input<typeof S.HeldRow>
export type InboxItem = z.input<typeof S.InboxItem>
export type InboxItemDetail = z.input<typeof S.InboxItemDetail>
export type InboxList = z.input<typeof S.InboxList>
export type Ledger = z.input<typeof S.Ledger>
export type LedgerRow = z.input<typeof S.LedgerRow>
export type ProposedAction = z.input<typeof S.ProposedAction>
export type Rule = z.input<typeof S.Rule>
export type RuleChange = z.input<typeof S.RuleChange>
export type RuleProposal = z.input<typeof S.RuleProposal>
export type RuleRow = z.input<typeof S.RuleRow>
export type RulesOut = z.input<typeof S.RulesOut>
export type SavedView = z.input<typeof S.SavedView>
export type StripSummary = z.input<typeof S.StripSummary>
