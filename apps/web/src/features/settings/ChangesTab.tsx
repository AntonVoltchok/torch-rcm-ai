/** Changes: every rule change with who, before → after and the items run under it since; the weekly owner digest on top. */
import type { RuleChange, RuleDigest, RulesOut } from '@/api/schema'
import { count, dateTime } from '@/lib/format'
import { SimpleTable } from '@/components/SimpleTable'
import { EmptyState } from '@/components/EmptyState'
import { changeDiff, digestText, findRow, userName } from './selectors'

export function ChangesTab({ changes, digest, rules }: { changes: RuleChange[]; digest: RuleDigest; rules: RulesOut | undefined }) {
  return (
    <div className="flex flex-col gap-3 p-5">
      <p
        className="m-0 rounded-md border border-line bg-fill px-3 py-1.5 text-sm"
        data-testid="owner-digest"
        title="Sent Monday morning; counts this week from Monday, the same week as Activity"
      >
        {digestText(digest)}
      </p>
      {changes.length === 0 ? (
        <EmptyState title="No rule changes yet" />
      ) : (
        <SimpleTable
          label="Rule changes"
          rows={changes}
          rowKey={(c) => c.id}
          cols={[
            { header: 'Date', cell: (c) => dateTime(c.at) },
            { header: 'Who', cell: (c) => <span className="font-medium">{userName(c.by)}</span> },
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
