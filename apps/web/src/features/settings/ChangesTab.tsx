/** Changes: every rule change with who, before → after and the items run under it since; the weekly owner digest on top. */
import type { RuleChange, RulesOut } from '@/api/schema'
import { useInboxList } from '@/hooks/useInbox'
import { useNow } from '@/hooks/useClock'
import { count, dateTime } from '@/lib/format'
import { SimpleTable } from '@/components/SimpleTable'
import { EmptyState } from '@/components/EmptyState'
import { changeDiff, findRow, userName, weeklyDigest } from './selectors'

export function ChangesTab({ changes, rules }: { changes: RuleChange[]; rules: RulesOut | undefined }) {
  const now = useNow()
  // Sign-offs still waiting = open owner_signoff items (the server's list, not a client count).
  const signoffs = useInboxList({ state: 'open', kind: 'owner_signoff' })
  const digest = now ? weeklyDigest(changes, now, signoffs.data?.total ?? 0) : null
  return (
    <div className="flex flex-col gap-2 p-4">
      {digest && (
        <p className="m-0 rounded-md border border-line bg-fill px-3 py-1.5 text-sm" data-testid="owner-digest">
          {digest.text}
        </p>
      )}
      {changes.length === 0 ? (
        <EmptyState title="No rule changes yet" />
      ) : (
        <SimpleTable
          label="Rule changes"
          rows={changes}
          rowKey={(c) => c.id}
          cols={[
            { header: 'Date', cell: (c) => dateTime(c.at) },
            { header: 'Who', cell: (c) => <b>{userName(c.by)}</b> },
            { header: 'Rule', cell: (c) => findRow(rules, c.rule_id)?.rule.label ?? c.rule_id },
            {
              header: 'Before → after',
              cell: (c) => {
                const diff = changeDiff(c)
                return <span className="text-sm">{diff.length ? diff.join(' · ') : c.summary || '—'}</span>
              },
            },
            { header: 'Items run since', cell: (c) => count(c.items_affected_since), className: 'text-right' },
          ]}
        />
      )}
    </div>
  )
}
