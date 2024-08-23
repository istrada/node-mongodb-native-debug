import { join } from 'path';

import { loadSpecTests } from '../../spec';
import { runUnifiedSuite } from '../../tools/unified-spec-runner/runner';

const skippedSpecs = {
  bulkWrite: 'TODO(NODE-6274)',
  'change-streams': 'TODO(NODE-6035)',
  'convenient-transactions': 'TODO(NODE-5687)',
  'deprecated-options': 'TODO(NODE-5689)',
  'gridfs-advanced': 'TODO(NODE-6275)',
  'gridfs-delete': 'TODO(NODE-6275)',
  'gridfs-download': 'TODO(NODE-6275)',
  'gridfs-find': 'TODO(NODE-6275)',
  'gridfs-upload': 'TODO(NODE-6275)',
  'sessions-inherit-timeoutMS': 'TODO(NODE-5687)',
  'sessions-override-operation-timeoutMS': 'TODO(NODE-5687)',
  'sessions-override-timeoutMS': 'TODO(NODE-5687)',
  'tailable-awaitData': 'TODO(NODE-6035)',
  'tailable-non-awaitData': 'TODO(NODE-6035)'
};

const skippedTests = {
  'timeoutMS can be configured on a MongoClient - insertMany on collection': 'TODO(NODE-6274)',
  'timeoutMS can be configured on a MongoClient - bulkWrite on collection': 'TODO(NODE-6274)',
  'timeoutMS can be configured on a MongoClient - createChangeStream on client': 'TODO(NODE-6305)',
  'timeoutMS applies to whole operation, not individual attempts - createChangeStream on client':
    'TODO(NODE-6305)',
  'Tailable cursor iteration timeoutMS is refreshed for getMore - failure': 'TODO(NODE-6305)',
  'Tailable cursor awaitData iteration timeoutMS is refreshed for getMore - failure':
    'TODO(NODE-6305)',
  'timeoutMS applies to whole operation, not individual attempts - insertMany on collection':
    'TODO(NODE-6274)',
  'timeoutMS applies to whole operation, not individual attempts - bulkWrite on collection':
    'TODO(NODE-6274)'
};

describe('CSOT spec tests', function () {
  const specs = loadSpecTests(join('client-side-operations-timeout'));
  for (const spec of specs) {
    for (const test of spec.tests) {
      if (skippedSpecs[spec.name] != null) {
        test.skipReason = skippedSpecs[spec.name];
      }
      if (skippedTests[test.description] != null) {
        test.skipReason = skippedTests[test.description];
      }
    }
  }

  runUnifiedSuite(specs);
});
