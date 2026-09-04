'use client';

import { useState } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import type {
  CoverageReport,
  OperationCoverage,
  StatusCoverage,
  TagCoverage,
  TestSnippet
} from '@/lib/api-test-coverage';

// ============================================================================
// Helpers
// ============================================================================

function verdictOf(status: StatusCoverage): 'ok' | 'gap' | 'undoc' {
  if (!status.documented) return 'undoc';
  return status.assertions > 0 ? 'ok' : 'gap';
}

/** Render {slug} path segments in a muted tone so parameters read apart */
function PathInk({ specPath }: { specPath: string }) {
  const parts = specPath.split(/(\{[^}]+\})/g).filter(Boolean);
  return (
    <span className="text-sm tracking-tight">
      {parts.map((part, i) =>
        part.startsWith('{') ? (
          <em key={i} className="not-italic text-muted-foreground">
            {part}
          </em>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

/** What the code panel is showing: one status of one operation */
interface Evidence {
  operation: OperationCoverage;
  status: StatusCoverage;
}

// ============================================================================
// Test-code panel
// ============================================================================

function SnippetBlock({ snippet, code }: { snippet: TestSnippet; code: string }) {
  const hitRe = new RegExp(`\\.status\\)\\.(?:toBe|toEqual)\\(\\s*${code}\\s*\\)`);
  const lines = snippet.source.split('\n');
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-baseline gap-3">
        <span className="text-xs font-medium">{snippet.title}</span>
        <span className="sp-leader" aria-hidden />
        <span className="shrink-0 text-[0.65rem] text-muted-foreground">L{snippet.startLine}</span>
      </figcaption>
      <pre className="sp-codeblock py-2">
        {lines.map((line, i) => (
          <div key={i} className="sp-codeline" data-hit={hitRe.test(line) ? '' : undefined}>
            <span className="sp-lineno">{snippet.startLine + i}</span>
            <code>{line || ' '}</code>
          </div>
        ))}
      </pre>
    </figure>
  );
}

function EvidencePanel({
  evidence,
  onClose
}: {
  evidence: Evidence | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={evidence !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="proof-root w-full overflow-y-auto border-l border-[var(--sp-hair-strong)] sm:max-w-2xl">
        {evidence && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="flex items-baseline gap-3 font-normal">
                <span
                  className="sp-method shrink-0 uppercase"
                  data-method={evidence.operation.method}
                >
                  {evidence.operation.method}
                </span>
                <span className="font-mono text-sm">{evidence.operation.specPath}</span>
                <span className="sp-code text-lg font-semibold" data-class={evidence.status.code[0]}>
                  {evidence.status.code}
                </span>
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {evidence.status.description}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 flex flex-col gap-8">
              {evidence.status.snippets.map((snippet) => (
                <SnippetBlock key={snippet.startLine} snippet={snippet} code={evidence.status.code} />
              ))}
            </div>

            {evidence.operation.testFile && (
              <p className="mt-8 flex flex-wrap items-baseline gap-x-1.5 border-t border-dashed pt-3 text-[0.65rem] text-muted-foreground">
                <span className="tracking-[0.14em]">SOURCE ·</span>
                <span className="font-mono tracking-normal">{evidence.operation.testFile}</span>
              </p>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// Status list (accordion body)
// ============================================================================

function StatusList({
  operation,
  onShowEvidence
}: {
  operation: OperationCoverage;
  onShowEvidence: (evidence: Evidence) => void;
}) {
  return (
    <div className="flex flex-col gap-0 pl-[calc(0.6rem+3px)]">
      {operation.statuses.map((status) => {
        const verdict = verdictOf(status);
        const hasEvidence = status.snippets.length > 0;
        return (
          <div key={status.code} className="flex items-baseline gap-3 py-1.5">
            <span
              className="sp-code w-8 shrink-0 text-sm font-semibold"
              data-class={status.code[0]}
            >
              {status.code}
            </span>
            <span className="text-xs text-muted-foreground">{status.description}</span>
            <span className="sp-leader" aria-hidden />
            {verdict === 'ok' && (
              <span className="shrink-0 text-[0.68rem] text-muted-foreground">
                {status.assertions} assertion{status.assertions === 1 ? '' : 's'}
              </span>
            )}
            {hasEvidence ? (
              <button
                type="button"
                className="sp-stamp shrink-0"
                data-verdict={verdict}
                title="Show the test code"
                onClick={() => onShowEvidence({ operation, status })}
              >
                {verdict === 'ok' ? 'VERIFIED' : 'UNDOCUMENTED'} ⌕
              </button>
            ) : (
              <span className="sp-stamp shrink-0" data-verdict={verdict}>
                {verdict === 'ok' ? 'VERIFIED' : verdict === 'gap' ? 'NO TEST' : 'UNDOCUMENTED'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Operation row
// ============================================================================

function OperationRow({
  operation,
  onShowEvidence
}: {
  operation: OperationCoverage;
  onShowEvidence: (evidence: Evidence) => void;
}) {
  const documented = operation.statuses.filter((s) => s.documented);
  return (
    <AccordionItem
      value={`${operation.method} ${operation.specPath}`}
      className="sp-oprow border-b-0"
    >
      <AccordionTrigger className="gap-3 px-3 py-3.5 hover:no-underline">
        <span className="sp-method w-16 shrink-0 uppercase" data-method={operation.method}>
          {operation.method}
        </span>
        <PathInk specPath={operation.specPath} />
        <span className="sp-marks ml-auto shrink-0" aria-hidden>
          {operation.statuses.map((status) => (
            <span key={status.code} className="sp-mark" data-state={verdictOf(status)} />
          ))}
        </span>
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {operation.coveredCount}/{documented.length}
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-5">
        {operation.summary && (
          <p className="mb-3 pl-[calc(0.6rem+3px)] text-xs text-muted-foreground">
            {operation.summary}
          </p>
        )}
        <StatusList operation={operation} onShowEvidence={onShowEvidence} />
      </AccordionContent>
    </AccordionItem>
  );
}

// ============================================================================
// Tag section
// ============================================================================

function TagSection({
  tag,
  index,
  onShowEvidence
}: {
  tag: TagCoverage;
  index: number;
  onShowEvidence: (evidence: Evidence) => void;
}) {
  return (
    <AccordionItem
      value={tag.tag}
      className="sp-rise border-b-0"
      style={{ '--sp-stagger': index + 3 } as React.CSSProperties}
    >
      <AccordionTrigger className="items-baseline gap-4 border-b py-0 pb-2 hover:no-underline">
        <span className="text-sm font-semibold uppercase tracking-[0.08em]">{tag.tag}</span>
        <span className="hidden text-xs text-muted-foreground sm:block">{tag.description}</span>
        <span className="ml-auto text-sm font-normal tabular-nums text-muted-foreground">
          <span className="text-foreground">{tag.coveredCount}</span>/{tag.totalCount} verified
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-0 pt-0">
        <Accordion type="multiple" className="divide-y divide-[var(--sp-hair)]">
          {tag.operations.map((operation) => (
            <OperationRow
              key={`${operation.method} ${operation.specPath}`}
              operation={operation}
              onShowEvidence={onShowEvidence}
            />
          ))}
        </Accordion>
      </AccordionContent>
    </AccordionItem>
  );
}

// ============================================================================
// Proof
// ============================================================================

export function CoverageProof({
  report,
  compiledAt,
  version
}: {
  report: CoverageReport;
  compiledAt: string;
  version: string;
}) {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const gapCount = report.totalCount - report.coveredCount;
  const verifiedPct = Math.round((report.coveredCount / Math.max(report.totalCount, 1)) * 100);
  const facts: Array<[string, string]> = [
    ['operations', String(report.operationCount)],
    ['status pairs verified', `${report.coveredCount}/${report.totalCount}`],
    ['gaps', String(gapCount)],
    ['untested routes', String(report.untestedOperations)]
  ];

  return (
    <div className="proof-root proof-page min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-14 px-6 py-16">
        {/* masthead */}
        <header
          className="sp-rise flex flex-col gap-8"
          style={{ '--sp-stagger': 0 } as React.CSSProperties}
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="text-5xl font-semibold tracking-tight">{report.repoName}</h1>
            <div className="text-right">
              <div className="mt-2 text-[0.65rem] tracking-[0.18em] tabular-nums text-muted-foreground">
                {new Date(compiledAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
              </div>
            </div>
          </div>

          {/* report metadata */}
          <dl className="sp-rule-double flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b py-4">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[0.65rem] tracking-[0.18em] text-muted-foreground">
                  {label.toUpperCase()}
                </dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
            <div className="text-right">
              <dt className="text-[0.65rem] tracking-[0.18em] text-muted-foreground">
                RESPONSES VERIFIED
              </dt>
              <dd className="mt-2 text-2xl font-semibold tabular-nums">
                {verifiedPct}
                <span className="text-base font-normal text-muted-foreground">%</span>
              </dd>
            </div>
          </dl>
        </header>

        {/* tag sections */}
        {report.operationCount === 0 ? (
          <section
            className="sp-rise border border-dashed px-6 py-10 text-center"
            style={{ '--sp-stagger': 3 } as React.CSSProperties}
          >
            {report.hasSpec ? (
              // A spec was found, it just has no operations yet — the state a
              // repo sits in while the API is still being written. Point at
              // the next edit rather than at how to find a spec.
              <>
                <p className="text-sm font-semibold tracking-[0.14em]">NO OPERATIONS DOCUMENTED YET</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  The spec was found and parsed, but documents no paths. Add one and this view
                  updates as you save.
                </p>
                <pre className="mt-4 inline-block text-left text-xs text-foreground/70">
{`paths:
  /tasks:
    get:
      responses:
        "200": { description: OK }`}
                </pre>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold tracking-[0.14em]">NO API DEFINITION PROVIDED</p>
                <div className="mt-4 flex flex-col gap-1 text-xs text-muted-foreground">
                  <code className="text-foreground/70">specproof dev --repo /path/to/repo</code>
                  <code className="text-foreground/70">specproof generate --spec path/to/openapi.json</code>
                </div>
              </>
            )}
          </section>
        ) : (
          <Accordion
            type="multiple"
            defaultValue={report.tags.map((tag) => tag.tag)}
            className="flex flex-col gap-14"
          >
            {report.tags.map((tag, i) => (
              <TagSection key={tag.tag} tag={tag} index={i} onShowEvidence={setEvidence} />
            ))}
          </Accordion>
        )}

        <footer className="sp-rule-double mt-auto flex flex-wrap items-center justify-between gap-4 border-t pt-4 text-[0.65rem] tracking-[0.18em] text-muted-foreground">
          <span>GENERATED BY SPECPROOF</span>
          <span className="tabular-nums">v{version}</span>
          <span>
            BUILT BY{' '}
            <a
              href="https://x.com/_DurableQuality"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
            >
              DURABLE QUALITY
            </a>
          </span>
        </footer>
      </div>

      <EvidencePanel evidence={evidence} onClose={() => setEvidence(null)} />
    </div>
  );
}
