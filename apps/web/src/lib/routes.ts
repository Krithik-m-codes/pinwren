import type { Route } from "next";

/**
 * The current page with a new query string. `usePathname()` is typed `string`, but it is always one of this
 * app's routes, so the result is a valid `Route` for `router.replace()` and `<Link>` (typedRoutes).
 */
export function here(pathname: string, search?: string | URLSearchParams): Route {
  const query = search?.toString();
  return (query ? `${pathname}?${query}` : pathname) as Route;
}
