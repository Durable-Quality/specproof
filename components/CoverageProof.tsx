'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

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
import { buildSuggestedTest } from '@/lib/test-suggestion';
import type {
  CoverageReport,
  OperationCoverage,
  StatusCoverage,
  TagCoverage,
  TestFrameworkInfo,
  TestSnippet
} from '@/lib/api-test-coverage';

// ============================================================================
// Helpers
// ============================================================================

/**
 * The test verdict for one status. Keyed off the assertions first: with none,
 * the row is a gap whether the spec documents the status (a response nobody
 * tests) or SpecProof expected it and the spec omits it (`status.expected`).
 * UNDOCUMENTED is reserved for what it has always meant: a status the tests do
 * assert, that the spec never mentions.
 */
function verdictOf(status: StatusCoverage): 'ok' | 'gap' | 'undoc' {
  if (status.assertions === 0) return 'gap';
  return status.documented ? 'ok' : 'undoc';
}


/**
 * What stands in the description slot for one status: the spec's own words, or
 * a quiet stamp naming which of the two ways the spec is silent. The two are
 * different holes and read differently. MISSING FROM SPEC is about the status
 * itself, so it shows whether the row was synthesized or produced by a test
 * assertion the spec never documents; NO DESCRIPTION is about a response the
 * spec does list, and left blank.
 *
 * Neither ever stands in for text the spec did write: a description shown here
 * is the spec's, verbatim.
 */
function StatusDescription({ status }: { status: StatusCoverage }) {
  if (!status.documented) {
    return (
      <span
        className="sp-stamp shrink-0"
        data-verdict="nospec"
        title={`The OpenAPI spec documents no ${status.code} response for this operation`}
      >
        MISSING FROM SPEC
      </span>
    );
  }
  if (!status.description) {
    return (
      <span
        className="sp-stamp shrink-0"
        data-verdict="nodesc"
        title="This response has no description in the OpenAPI spec"
      >
        NO DESCRIPTION
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">{status.description}</span>;
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

/**
 * The suggested test for a response nothing asserts. Built in the browser from
 * the checked-in proof by the same function the apply route writes with, so
 * what is shown is what lands on disk — no round trip needed to read it, and
 * nothing to diff against once it is applied.
 */
function SuggestionBody({
  operation,
  status,
  framework
}: {
  operation: OperationCoverage;
  status: StatusCoverage;
  framework: TestFrameworkInfo;
}) {
  const mode = operation.testFile ? 'append' : 'create';
  const suggestion = useMemo(
    () =>
      buildSuggestedTest({
        method: operation.method,
        specPath: operation.specPath,
        status: status.code,
        hasRequestBody: operation.hasRequestBody,
        framework: framework.id,
        mode
      }),
    [operation, status.code, framework.id, mode]
  );

  // Applying writes into the audited repo, which only the machine running the
  // dev server can do. Asked once per opened panel rather than assumed, so a
  // build served from anywhere else offers the code without a button that
  // cannot work.
  const [target, setTarget] = useState<{ writable: boolean; reason: string | null } | null>(null);
  const [applied, setApplied] = useState<{ ok: boolean; message: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/suggested-test')
      .then((res) => res.json())
      .then((data) => !cancelled && setTarget(data))
      .catch(
        () =>
          !cancelled &&
          setTarget({ writable: false, reason: 'the SpecProof server is not reachable' })
      );
    return () => {
      cancelled = true;
    };
  }, []);

  async function apply() {
    setApplying(true);
    setApplied(null);
    try {
      const res = await fetch('/api/suggested-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: operation.method,
          specPath: operation.specPath,
          status: status.code
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setApplied({ ok: false, message: data.error ?? `apply failed (${res.status})` });
      } else {
        const wrote = [
          `${data.created ? 'Wrote' : 'Updated'} ${data.file}`,
          data.specFile ? `documented ${status.code} in ${data.specFile}` : null
        ]
          .filter(Boolean)
          .join(', ');
        setApplied({
          ok: true,
          message: data.refreshError
            ? `${wrote}. The audit view could not be refreshed: ${data.refreshError}`
            : `${wrote}. Run it to prove the response.`
        });
        // The route has already rewritten the proof this page renders; this
        // pulls the new one in without waiting on a file-watch event.
        if (!data.refreshError) router.refresh();
      }
    } catch (error) {
      setApplied({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <p className="mt-4 flex flex-wrap items-baseline gap-x-1.5 border-t border-dashed pt-3 text-xs font-bold text-muted-foreground">
        <span className="tracking-[0.14em]">{mode === 'create' ? 'NEW FILE ·' : 'APPEND TO ·'}</span>
        <span className="font-mono tracking-normal">{operation.suggestedTestFile}</span>
      </p>
      <p className="mt-1.5 text-[0.65rem] text-muted-foreground">
        {framework.detected
          ? `Written for ${framework.id}: ${framework.evidence}.`
          : `No framework SpecProof can read assertions from: ${framework.evidence}. Suggesting ${framework.id}.`}
        {!status.documented &&
          ` Applying also documents the ${status.code} response in the OpenAPI spec, which does not list it.`}
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-medium">{suggestion.title}</span>
          <span className="sp-leader" aria-hidden />
          <button
            type="button"
            className="sp-action shrink-0"
            onClick={apply}
            disabled={applying || target?.writable === false}
            title={
              target?.reason ??
              (status.documented
                ? 'Write this test into the audited repo'
                : 'Write this test and document the response in the spec')
            }
          >
            {applying ? 'APPLYING…' : 'APPLY'}
          </button>
        </div>
        <pre className="sp-codeblock py-2" data-plain>
          {suggestion.preview.split('\n').map((line, i) => (
            <div
              key={i}
              className="sp-codeline"
              data-pending={/\.status\)\.toBe\(/.test(line) ? '' : undefined}
            >
              <code>{line || ' '}</code>
            </div>
          ))}
        </pre>
        {applied && (
          <p
            className="text-xs"
            data-applied={applied.ok ? 'ok' : 'error'}
            style={{ color: applied.ok ? 'var(--sp-ok)' : 'var(--sp-gap)' }}
          >
            {applied.message}
          </p>
        )}
        {!applied && target && !target.writable && (
          <p className="text-xs text-muted-foreground">
            Applying is unavailable here: {target.reason}.
          </p>
        )}
      </div>
    </>
  );
}

function EvidencePanel({
  evidence,
  framework,
  onClose
}: {
  evidence: Evidence | null;
  framework: TestFrameworkInfo;
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
                <span
                  className="sp-code text-lg font-semibold"
                  data-class={evidence.status.code[0]}
                  data-absent={evidence.status.documented ? undefined : ''}
                >
                  {evidence.status.code}
                </span>
              </SheetTitle>
              <SheetDescription className="font-mono text-xs" asChild>
                <div>
                  <StatusDescription status={evidence.status} />
                </div>
              </SheetDescription>
            </SheetHeader>

            {verdictOf(evidence.status) === 'gap' ? (
              <SuggestionBody
                key={`${evidence.operation.method} ${evidence.operation.specPath} ${evidence.status.code}`}
                operation={evidence.operation}
                status={evidence.status}
                framework={framework}
              />
            ) : (
              <>
                {evidence.operation.testFile && (
                  <p className="mt-4 flex flex-wrap items-baseline gap-x-1.5 border-t border-dashed pt-3 text-xs font-bold text-muted-foreground">
                    <span className="tracking-[0.14em]">SOURCE ·</span>
                    <span className="font-mono tracking-normal">{evidence.operation.testFile}</span>
                  </p>
                )}

                <div className="mt-6 flex flex-col gap-8">
                  {evidence.status.snippets.map((snippet) => (
                    <SnippetBlock
                      key={snippet.startLine}
                      snippet={snippet}
                      code={evidence.status.code}
                    />
                  ))}
                </div>
              </>
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
              data-absent={status.documented ? undefined : ''}
            >
              {status.code}
            </span>
            <StatusDescription status={status} />
            <span className="sp-leader" aria-hidden />
            {verdict !== 'gap' && (
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
            ) : verdict === 'gap' ? (
              <button
                type="button"
                className="sp-stamp shrink-0"
                data-verdict="gap"
                title="Show a suggested test for this response"
                onClick={() => onShowEvidence({ operation, status })}
              >
                NO TEST ✎
              </button>
            ) : (
              <span className="sp-stamp shrink-0" data-verdict={verdict}>
                {verdict === 'ok' ? 'VERIFIED' : 'UNDOCUMENTED'}
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
  // One tally over the rows the accordion prints, so the marks beside it and
  // the statuses inside it are always counting the same thing.
  const total = operation.coveredCount + operation.gapCount;
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
            <span
              key={status.code}
              className="sp-mark"
              data-state={status.expected ? 'absent' : verdictOf(status)}
            />
          ))}
        </span>
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {operation.coveredCount}/{total}
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-5">
        <p className="mb-3 pl-[calc(0.6rem+3px)] text-xs text-muted-foreground">
          {operation.summary || (
            <span
              className="sp-stamp"
              data-verdict="nodesc"
              title="This operation has no summary in the OpenAPI spec"
            >
              NO DESCRIPTION
            </span>
          )}
        </p>
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
              href="https://x.com/DurableQA"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
            >
              DURABLE QUALITY
            </a>
          </span>
        </footer>
      </div>

      <EvidencePanel
        evidence={evidence}
        framework={report.testFramework}
        onClose={() => setEvidence(null)}
      />
    </div>
  );
}
