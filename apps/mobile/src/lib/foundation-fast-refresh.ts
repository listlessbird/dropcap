export interface FoundationHotModule {
  readonly accept: (callback?: () => void) => void;
  readonly dispose: (callback: () => void) => void;
}

const reportDisposeFailure = console.error.bind(
  console,
  "[fast-refresh] could not dispose replaced mobile foundation",
);

/**
 * Disposes an app-lifetime resource (atom registry, managed runtime) when Fast Refresh replaces
 * the module that created it, so the replacement does not leak the old one.
 */
export function disposeOnFoundationReplace(
  hotModule: FoundationHotModule | undefined,
  dispose: () => void | Promise<void>,
): void {
  if (hotModule === undefined || typeof __DEV__ === "undefined" || !__DEV__) return;

  hotModule.dispose(() => {
    Promise.resolve().then(dispose).catch(reportDisposeFailure);
  });
}
