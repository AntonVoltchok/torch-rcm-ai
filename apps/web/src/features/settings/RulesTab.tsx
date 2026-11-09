/**
 * The tiered rules table (mocks Round 4 Part A, revised Round 5): one table, rows grouped by what the action
 * touches, a mode control per row, the live preview above it, the weekly tally below it.
 */
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { PreviewParams } from '@/api/endpoints'
import type { RuleMode, RulesOut } from '@/api/schema'
import { usePatchRule } from '@/hooks/useRules'
import { AGENT_NAME } from '@/lib/payers'
import { count } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useCurrentUser } from '@/state/session'
import { TierBadge } from '@/components/TierBadge'
import { Chip } from '@/components/Chip'
import { ModeControl } from './ModeControl'
import { PreviewPanel } from './PreviewPanel'
import { PracticeCapEditor, RuleCapEditor } from './CapEditors'
import { findRow, tierViews } from './selectors'

/** The rule the preview starts on: the one the Delta proposal would change (the mocks' "41 → 44"). */
export const DEFAULT_PREVIEW_RULE = 'rule_t1_delta_pa'

const COLS = ['Action', 'Scope', 'Mode', 'Confidence floor · base rate', 'Outcome metric', 'Reverses in', 'Ran without review · 7 d', 'Changed', 'Owner sign-off'] as const

export function RulesTab({ data, selected }: { data: RulesOut; selected: string | undefined }) {
  const user = useCurrentUser()
  const navigate = useNavigate({ from: '/settings/agents' })
  const patch = usePatchRule()
  const [hover, setHover] = useState<{ rule_id: string; mode: RuleMode } | null>(null)
  const [capTrial, setCapTrial] = useState<{ rule_id: string; max_cents: number } | null>(null)

  const tiers = tierViews(data, user.role)
  const selectedRow = findRow(data, selected) ?? findRow(data, DEFAULT_PREVIEW_RULE)
  const selectedId = selectedRow?.rule.id
  const canChange = user.role === 'owner' || user.role === 'billing'

  const target: PreviewParams | null = hover
    ? { rule_id: hover.rule_id, mode: hover.mode }
    : selectedRow && selectedRow.rule.tier !== 3
      ? {
          rule_id: selectedRow.rule.id,
          mode: 'auto',
          ...(capTrial?.rule_id === selectedRow.rule.id ? { max_cents: capTrial.max_cents } : {}),
        }
      : null
  const targetRow = findRow(data, target?.rule_id)

  const select = (ruleId: string) => {
    setCapTrial(null)
    void navigate({ search: (s) => ({ ...s, rule: ruleId }), replace: true })
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <PreviewPanel target={target} ruleLabel={targetRow?.rule.label} currentMode={targetRow?.rule.mode} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm text-mid">
          <span>Most specific wins: payer + item type beats “All” · row order never matters</span>
          <PracticeCapEditor cents={data.practice_cap_cents} canEdit={user.role === 'owner'} />
          {selectedRow && selectedRow.rule.tier !== 3 && canChange && (
            <div className="flex flex-col gap-0.5">
              <span>
                Selected: <b className="text-ink">{selectedRow.rule.label}</b>
              </span>
              <RuleCapEditor
                key={selectedRow.rule.id}
                cents={selectedRow.rule.scope?.max_cents ?? null}
                busy={patch.isPending}
                onPreview={(cents) => setCapTrial(cents === null ? null : { rule_id: selectedRow.rule.id, max_cents: cents })}
                onApply={(cents) => patch.mutate({ ruleId: selectedRow.rule.id, label: selectedRow.rule.label, patch: { max_cents: cents } })}
              />
            </div>
          )}
        </div>
      </div>

      <table aria-label="Agent rules" data-tour="rules-table" className="w-full border-collapse text-base">
        <thead className="sticky top-0 z-[1] bg-paper">
          <tr>
            {COLS.map((c) => (
              <th key={c} className={cn('h-8 whitespace-nowrap border-b border-line px-2 text-left text-xs font-medium text-soft', c.startsWith('Ran') && 'text-right')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        {tiers.map((t) => (
          <tbody key={t.tier} aria-label={`Tier ${t.tier} · ${t.label}`} data-tier={t.tier}>
            <tr className="bg-fill">
              <th colSpan={COLS.length} scope="rowgroup" className="border-b border-line px-2 py-1.5 text-left font-normal">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <TierBadge tier={t.tier} compact />
                  <b className="text-sm font-semibold text-ink">{t.label}</b>
                  <span className="text-sm text-mid">{t.summary}</span>
                  <span className="text-sm text-soft">{t.description}</span>
                </span>
              </th>
            </tr>
            {t.rows.map((r) => (
              <tr
                key={r.id}
                data-rule-id={r.id}
                aria-selected={r.id === selectedId}
                onClick={() => select(r.id)}
                className={cn(
                  'h-10 cursor-pointer border-b border-line align-middle',
                  r.id === selectedId ? 'bg-act-bg' : 'hover:bg-hover',
                  r.learned && 'shadow-[inset_3px_0_0_var(--color-ok)]',
                )}
              >
                <td className="min-w-60 px-2 py-1.5">
                  <div className="font-medium">{r.label}</div>
                  <div className="text-xs text-soft">
                    ✦ {AGENT_NAME[r.agent]}
                    {r.learned && (
                      <Chip tone="ok" className="ml-1">
                        learned
                      </Chip>
                    )}
                  </div>
                </td>
                <td className="min-w-28 px-2 text-sm text-mid">{r.scope}</td>
                <td className="px-2" onClick={(e) => e.stopPropagation()}>
                  <ModeControl
                    row={r}
                    busy={patch.isPending || !canChange}
                    onPreview={(mode) => setHover(mode ? { rule_id: r.id, mode } : null)}
                    onChange={(mode) => {
                      select(r.id)
                      patch.mutate({ ruleId: r.id, label: r.label, patch: { mode } })
                    }}
                  />
                </td>
                <td className={cn('px-2 text-sm', r.floor.tone === 'warn' ? 'font-semibold text-ink' : r.floor.tone === 'muted' ? 'text-soft' : 'text-ink')}>{r.floor.text}</td>
                <td className="px-2 text-sm text-mid">{r.outcome}</td>
                <td className="px-2 text-sm text-mid">{r.reverses}</td>
                <td
                  className="px-2 text-right text-sm"
                  title={
                    r.routine > 0
                      ? `${r.routine} routine runs this week. Routine payer contact is not a decision, so it stays out of the decisions below · ${r.waiting} waiting in the Inbox`
                      : `${r.ran} ran without review this week · ${r.waiting} waiting in the Inbox`
                  }
                >
                  {r.routine > 0 ? (
                    <>
                      <b>{count(r.routine)}</b> routine
                    </>
                  ) : (
                    <b>{count(r.ran)}</b>
                  )}
                  <span className="text-soft"> · {count(r.waiting)} waiting</span>
                </td>
                <td className="px-2 text-sm text-mid">{r.changed}</td>
                <td className={cn('px-2 text-sm', r.signoff.tone === 'ok' ? 'text-ok' : r.signoff.tone === 'warn' ? 'font-semibold text-ink' : 'text-soft')}>{r.signoff.text}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>

      <p className="m-0 text-sm text-mid" data-testid="week-tally">
        This week: <b className="text-ink">{count(data.this_week.ran)} ran without review</b> · <b className="text-ink">{count(data.this_week.to_you)} came to a person</b> · of{' '}
        {count(data.this_week.total)} decisions
      </p>
    </div>
  )
}
