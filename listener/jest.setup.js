
beforeEach(() => {
  jest.useFakeTimers({ legacyFakeTimers: false });
  jest.clearAllTimers();
});

afterEach(() => {
  try {
    jest.runOnlyPendingTimers();
    jest.runAllTimers();
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetAllMocks();
  }
});
