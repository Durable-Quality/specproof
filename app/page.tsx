import type { CoverageReport } from '@/lib/api-test-coverage';
import { CoverageLedger } from '@/components/CoverageLedger';

import ledger from './ledger.generated.json';

import './ledger.css';

/**
 * Test Ledger
 *
 * Audit view of OmniLens API test coverage: the OpenAPI spec's operations and
 * response statuses joined against the colocated route.test.ts assertions.
 * Renders the checked-in ledger.generated.json artifact — regenerated
 * automatically before dev/build and kept in lockstep with the sources by the
 * ledger-contract test.
 */
export default function TestLedgerPage() {
  const report = ledger as unknown as CoverageReport;
  return <CoverageLedger report={report} compiledAt={new Date().toISOString()} />;
}
