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
                {evidence.status.documented ? (
                  evidence.status.description
                ) : (
                  <span className="text-[var(--sp-undoc)]">
                    Asserted in tests but absent from the OpenAPI spec — document it or drop it.
                  </span>
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 flex flex-col gap-8">
              {evidence.status.snippets.map((snippet) => (
                <SnippetBlock key={snippet.startLine} snippet={snippet} code={evidence.status.code} />
              ))}
            </div>

            {evidence.operation.testFile && (
              <p className="mt-8 border-t border-dashed pt-3 text-[0.65rem] tracking-[0.14em] text-muted-foreground">
                SOURCE · {evidence.operation.testFile.toUpperCase()}
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
            <span className="text-xs text-muted-foreground">
              {status.documented
                ? status.description
                : 'asserted in tests, but absent from the OpenAPI spec'}
            </span>
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

      <div className="mt-3 flex items-center gap-2 border-t border-dashed pt-2.5 text-[0.68rem] text-muted-foreground">
        {operation.testFile && operation.testCount > 0 ? (
          <span>
            {operation.testCount} test{operation.testCount === 1 ? '' : 's'} in{' '}
            <span className="text-foreground/70">{operation.testFile}</span>
          </span>
        ) : (
          <span className="sp-stamp" data-verdict="gap">
            NO TEST FILE — THIS OPERATION SHIPS UNTESTED
          </span>
        )}
      </div>
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
        <span className="sp-leader hidden sm:block" aria-hidden />
        <span className="sp-marks shrink-0" aria-hidden>
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
    <section className="sp-rise" style={{ '--sp-stagger': index + 3 } as React.CSSProperties}>
      <header className="mb-1 flex items-baseline gap-4 border-b pb-2">
        <span className="text-[0.65rem] tracking-[0.2em] text-muted-foreground">
          {String(index + 1).padStart(2, '0')}
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">{tag.tag}</h2>
        <span className="hidden text-xs text-muted-foreground sm:block">{tag.description}</span>
        <span className="sp-leader" aria-hidden />
        <span className="text-sm tabular-nums text-muted-foreground">
          <span className="text-foreground">{tag.coveredCount}</span>/{tag.totalCount} verified
        </span>
      </header>
      <Accordion type="multiple" className="divide-y divide-[var(--sp-hair)]">
        {tag.operations.map((operation) => (
          <OperationRow
            key={`${operation.method} ${operation.specPath}`}
            operation={operation}
            onShowEvidence={onShowEvidence}
          />
        ))}
      </Accordion>
    </section>
  );
}

// ============================================================================
// Proof
// ============================================================================

export function CoverageProof({
  report,
  compiledAt
}: {
  report: CoverageReport;
  compiledAt: string;
}) {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const gapCount = report.totalCount - report.coveredCount;
  const facts: Array<[string, string]> = [
    ['operations', String(report.operationCount)],
    ['status pairs verified', `${report.coveredCount}/${report.totalCount}`],
    ['gaps', String(gapCount)],
    ['untested routes', String(report.untestedOperations)]
  ];

  return (
    <div className="proof-root proof-page min-h-screen">
      <div className="mx-auto flex max-w-4xl flex-col gap-14 px-6 py-16">
        {/* masthead */}
        <header className="sp-rise" style={{ '--sp-stagger': 0 } as React.CSSProperties}>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h1 className="text-2xl font-semibold tracking-tight">SpecProof</h1>
            <div className="text-right">
              <div className="text-5xl font-semibold tabular-nums leading-none">
                {Math.round((report.coveredCount / Math.max(report.totalCount, 1)) * 100)}
                <span className="text-2xl font-normal text-muted-foreground">%</span>
              </div>
              <div className="mt-2 text-[0.65rem] tracking-[0.14em] text-muted-foreground">
                DOCUMENTED RESPONSES VERIFIED
              </div>
            </div>
          </div>
        </header>

        {/* summary strip */}
        <dl
          className="sp-rise sp-rule-double flex flex-wrap items-baseline gap-x-10 gap-y-3 border-b py-3"
          style={{ '--sp-stagger': 1 } as React.CSSProperties}
        >
          {facts.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-2.5">
              <dd className="text-xl tabular-nums">{value}</dd>
              <dt className="text-[0.65rem] tracking-[0.18em] text-muted-foreground">
                {label.toUpperCase()}
              </dt>
            </div>
          ))}
          <div className="ml-auto text-[0.65rem] tracking-[0.18em] text-muted-foreground">
            COMPILED {new Date(compiledAt).toISOString().slice(0, 10)}
          </div>
        </dl>

        {/* legend */}
        <div
          className="sp-rise -mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.65rem] tracking-[0.14em] text-muted-foreground"
          style={{ '--sp-stagger': 2 } as React.CSSProperties}
        >
          <span className="flex items-center gap-2">
            <span className="sp-mark" data-state="ok" /> VERIFIED
          </span>
          <span className="flex items-center gap-2">
            <span className="sp-mark" data-state="gap" /> NO TEST
          </span>
          <span className="flex items-center gap-2">
            <span className="sp-mark" data-state="undoc" /> UNDOCUMENTED
          </span>
        </div>

        {/* tag sections */}
        {report.operationCount === 0 ? (
          <section
            className="sp-rise border border-dashed px-6 py-10 text-center"
            style={{ '--sp-stagger': 3 } as React.CSSProperties}
          >
            <p className="text-sm font-semibold tracking-[0.14em]">NO API DEFINITION PROVIDED</p>
            <div className="mt-4 flex flex-col gap-1 text-xs text-muted-foreground">
              <code className="text-foreground/70">SPECPROOF_REPO=/path/to/repo</code>
              <code className="text-foreground/70">bun run generate:proof</code>
            </div>
          </section>
        ) : (
          report.tags.map((tag, i) => (
            <TagSection key={tag.tag} tag={tag} index={i} onShowEvidence={setEvidence} />
          ))
        )}
      </div>

      <EvidencePanel evidence={evidence} onClose={() => setEvidence(null)} />
    </div>
  );
}
