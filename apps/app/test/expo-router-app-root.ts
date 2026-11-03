// Vitest stand-in for expo-router's build-time route context.
// Metro compiles `expo-router/_ctx` into require.context(appRoot) and globs the
// route files; here tests build the same callable shape (ctx(key), ctx.keys(),
// ctx.resolve(key)) over statically imported route modules and pass it to
// <ExpoRoot context={…} />. Keys use Metro's convention: "./_layout",
// "./stories/[id]".
export type RouteModule = { default: unknown } & Record<string, unknown>;

export type RouteContext = ((key: string) => RouteModule) & {
  keys(): string[];
  resolve(key: string): string;
  /** expo-router's RequireContext declares it; nothing calls it. */
  id: string;
};

export function expoRouterTestContext(modules: Record<string, RouteModule>): RouteContext {
  const keys = Object.keys(modules);
  const ctx = (key: string): RouteModule => {
    const found = modules[key];
    if (!found) throw new Error(`route context: no module for ${key}`);
    return found;
  };
  return Object.assign(ctx, {
    keys: () => keys,
    resolve: (key: string) => key,
    id: "expo-router-test-context",
  });
}
