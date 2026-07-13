import type { CoverageReport } from '@/lib/api-test-coverage';
import { CoverageProof } from '@/components/CoverageProof';

import proof from './proof.generated.json';

import './proof.css';

/**
 * SpecProof
 *
 * Audit view of a repo's API test coverage: the OpenAPI spec's operations and
 * response statuses joined against the repo's test assertions. Renders the
 * checked-in proof.generated.json artifact — regenerated automatically
 * before dev/build and kept in lockstep with the sources by the
 * proof-contract test.
 */
export default function SpecProofPage() {
  const report = proof as unknown as CoverageReport;
  return <CoverageProof report={report} compiledAt={new Date().toISOString()} />;
}
