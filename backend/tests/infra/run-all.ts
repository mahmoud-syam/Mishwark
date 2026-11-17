import fs from 'fs';
import path from 'path';
import {
  getRegisteredTests,
  clearRegisteredTests,
  TestCase,
  TestResult,
  describe,
  test,
  it,
  expect,
  AssertionError,
} from './test-framework';

export { describe, test, it, expect, AssertionError };

export async function runAllTests(): Promise<number> {
  const testsDir = path.resolve(__dirname, '..');
  const tiers = ['tier1', 'tier2', 'tier3', 'tier4'];
  const testFiles: { tier: string; filePath: string }[] = [];

  for (const tier of tiers) {
    const tierDirPath = path.join(testsDir, tier);
    if (fs.existsSync(tierDirPath)) {
      const files = fs.readdirSync(tierDirPath);
      for (const file of files) {
        if (file.endsWith('.test.ts') || file.endsWith('.spec.ts')) {
          testFiles.push({
            tier,
            filePath: path.join(tierDirPath, file),
          });
        }
      }
    }
  }

  console.log('\n===============================================================');
  console.log('         MISHWARK BACKEND E2E MASTER TEST RUNNER               ');
  console.log('===============================================================\n');

  if (testFiles.length === 0) {
    console.log('⚠️  No test files discovered in tests/tier1..4');
    return 0;
  }

  console.log(`Discovered ${testFiles.length} test suite file(s):\n`);
  for (const tf of testFiles) {
    console.log(`  • [${tf.tier}] ${path.relative(testsDir, tf.filePath)}`);
  }
  console.log('\n---------------------------------------------------------------\n');

  let totalExecuted = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  const startTime = Date.now();
  const allResults: TestResult[] = [];

  for (const tf of testFiles) {
    const relativePath = path.relative(testsDir, tf.filePath);
    console.log(`\n▶ Running Suite: ${relativePath}`);
    clearRegisteredTests();

    try {
      // Dynamically import test suite file
      require(tf.filePath);
    } catch (importErr: any) {
      console.error(`❌ Failed to load test suite ${relativePath}:`, importErr);
      totalFailed++;
      totalExecuted++;
      allResults.push({
        suite: relativePath,
        name: 'Suite Module Load',
        passed: false,
        durationMs: 0,
        error: importErr,
      });
      continue;
    }

    const registered = getRegisteredTests();
    if (registered.length === 0) {
      console.log(`  ⚠️  No tests registered in ${relativePath}`);
      continue;
    }

    for (const testCase of registered) {
      totalExecuted++;
      const testStart = Date.now();
      let passed = false;
      let testErr: Error | undefined;

      try {
        await testCase.fn();
        passed = true;
        totalPassed++;
      } catch (err: any) {
        passed = false;
        totalFailed++;
        testErr = err;
      }

      const durationMs = Date.now() - testStart;
      const statusIcon = passed ? '✅ PASS' : '❌ FAIL';

      console.log(`  ${statusIcon} [${testCase.suite}] ${testCase.name} (${durationMs}ms)`);
      if (!passed && testErr) {
        console.error(`      └─ Error: ${testErr.message}`);
        if ((testErr as any).actual !== undefined && (testErr as any).expected !== undefined) {
          console.error(`         Actual: ${JSON.stringify((testErr as any).actual)}`);
          console.error(`         Expected: ${JSON.stringify((testErr as any).expected)}`);
        }
      }

      allResults.push({
        suite: `${relativePath} :: ${testCase.suite}`,
        name: testCase.name,
        passed,
        durationMs,
        error: testErr,
      });
    }
  }

  const totalDuration = Date.now() - startTime;

  console.log('\n===============================================================');
  console.log('                    TEST EXECUTION SUMMARY                     ');
  console.log('===============================================================');
  console.log(` Total Suites Executed : ${testFiles.length}`);
  console.log(` Total Test Cases      : ${totalExecuted}`);
  console.log(` Passed Test Cases     : ${totalPassed}`);
  console.log(` Failed Test Cases     : ${totalFailed}`);
  console.log(` Total Duration        : ${totalDuration} ms`);
  console.log('===============================================================\n');

  if (totalFailed > 0) {
    console.error(`❌ SUMMARY: ${totalFailed} test(s) failed.\n`);
    return 1;
  } else {
    console.log('✅ SUMMARY: All tests passed successfully!\n');
    return 0;
  }
}

if (require.main === module) {
  runAllTests()
    .then(async (exitCode) => {
      // Disconnecting Prisma is not enough on its own: api-client and the
      // scheduler leave timers/sockets behind, so the event loop never drains
      // and the runner appears to hang after printing the summary.
      try {
        const prisma = (await import('../../src/v1/utils/prismaClientHelper')).default;
        await prisma.$disconnect();
      } catch (e) {}
      process.exit(exitCode);
    })
    .catch(async (err) => {
      console.error('Fatal error during test runner execution:', err);
      try {
        const prisma = (await import('../../src/v1/utils/prismaClientHelper')).default;
        await prisma.$disconnect();
      } catch (e) {}
      process.exit(1);
    });
}
