export interface TestCase {
  suite: string;
  name: string;
  fn: () => void | Promise<void>;
}

export interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: Error;
}

const registry: TestCase[] = [];
let currentSuite = 'Default';

export function describe(suiteName: string, fn: () => void): void {
  const prevSuite = currentSuite;
  currentSuite = suiteName;
  fn();
  currentSuite = prevSuite;
}

export function test(name: string, fn: () => void | Promise<void>): void {
  registry.push({
    suite: currentSuite,
    name,
    fn,
  });
}

export const it = test;

export function getRegisteredTests(): TestCase[] {
  return [...registry];
}

export function clearRegisteredTests(): void {
  registry.length = 0;
}

export class AssertionError extends Error {
  constructor(message: string, public actual?: any, public expected?: any) {
    super(message);
    this.name = 'AssertionError';
  }
}

export function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new AssertionError(`Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`, actual, expected);
      }
    },
    toEqual(expected: any) {
      const actStr = JSON.stringify(actual);
      const expStr = JSON.stringify(expected);
      if (actStr !== expStr) {
        throw new AssertionError(`Expected ${actStr} to equal ${expStr}`, actual, expected);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new AssertionError(`Expected ${JSON.stringify(actual)} to be truthy`, actual, true);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new AssertionError(`Expected ${JSON.stringify(actual)} to be falsy`, actual, false);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new AssertionError(`Expected value to be defined`, actual, 'defined');
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        throw new AssertionError(`Expected ${JSON.stringify(actual)} to be undefined`, actual, undefined);
      }
    },
    toBeNull() {
      if (actual === null || actual === undefined) {
        // null assertion
      } else {
        throw new AssertionError(`Expected ${JSON.stringify(actual)} to be null`, actual, null);
      }
    },
    toContain(item: any) {
      if (Array.isArray(actual)) {
        if (!actual.includes(item)) {
          throw new AssertionError(`Expected array to contain ${JSON.stringify(item)}`, actual, item);
        }
      } else if (typeof actual === 'string') {
        if (!actual.includes(String(item))) {
          throw new AssertionError(`Expected string to contain ${JSON.stringify(item)}`, actual, item);
        }
      } else {
        throw new AssertionError(`Expected container to include ${JSON.stringify(item)}`, actual, item);
      }
    },
    toBeGreaterThan(num: number) {
      if (typeof actual !== 'number' || actual <= num) {
        throw new AssertionError(`Expected ${actual} to be greater than ${num}`, actual, num);
      }
    },
    toBeGreaterThanOrEqual(num: number) {
      if (typeof actual !== 'number' || actual < num) {
        throw new AssertionError(`Expected ${actual} to be >= ${num}`, actual, num);
      }
    },
    toBeLessThan(num: number) {
      if (typeof actual !== 'number' || actual >= num) {
        throw new AssertionError(`Expected ${actual} to be less than ${num}`, actual, num);
      }
    },
    toThrow(expectedError?: string | RegExp) {
      let threw = false;
      let thrownError: any = null;
      if (typeof actual !== 'function') {
        throw new AssertionError('expect(fn).toThrow requires fn to be a function');
      }
      try {
        actual();
      } catch (err: any) {
        threw = true;
        thrownError = err;
      }
      if (!threw) {
        throw new AssertionError('Expected function to throw an error, but it did not');
      }
      if (expectedError) {
        const msg = thrownError?.message || String(thrownError);
        if (typeof expectedError === 'string' && !msg.includes(expectedError)) {
          throw new AssertionError(`Expected error message to contain "${expectedError}", got "${msg}"`, msg, expectedError);
        } else if (expectedError instanceof RegExp && !expectedError.test(msg)) {
          throw new AssertionError(`Expected error message to match ${expectedError}, got "${msg}"`, msg, expectedError);
        }
      }
    },
    async toReject(expectedError?: string | RegExp) {
      let threw = false;
      let thrownError: any = null;
      if (typeof actual !== 'function') {
        throw new AssertionError('expect(fn).toReject requires fn to be an async function');
      }
      try {
        await actual();
      } catch (err: any) {
        threw = true;
        thrownError = err;
      }
      if (!threw) {
        throw new AssertionError('Expected async function to reject, but it resolved');
      }
      if (expectedError) {
        const msg = thrownError?.message || String(thrownError);
        if (typeof expectedError === 'string' && !msg.includes(expectedError)) {
          throw new AssertionError(`Expected rejection message to contain "${expectedError}", got "${msg}"`, msg, expectedError);
        } else if (expectedError instanceof RegExp && !expectedError.test(msg)) {
          throw new AssertionError(`Expected rejection message to match ${expectedError}, got "${msg}"`, msg, expectedError);
        }
      }
    },
    not: {
      toBe(expected: any) {
        if (actual === expected) {
          throw new AssertionError(`Expected ${JSON.stringify(actual)} NOT to be ${JSON.stringify(expected)}`, actual, expected);
        }
      },
      toBeNull() {
        if (actual === null) {
          throw new AssertionError(`Expected value NOT to be null`, actual, 'non-null');
        }
      },
      toBeUndefined() {
        if (actual === undefined) {
          throw new AssertionError(`Expected value NOT to be undefined`, actual, 'defined');
        }
      },
      toContain(item: any) {
        if (Array.isArray(actual) && actual.includes(item)) {
          throw new AssertionError(`Expected array NOT to contain ${JSON.stringify(item)}`, actual, item);
        }
      }
    }
  };
}
