// next/navigation in server components (the react-server condition):
// navigation errors and ReadonlyURLSearchParams. The hooks belong to
// client components.
export * from "./navigation-shared.js";

function clientOnly(name) {
  return () => {
    throw new Error(`${name} only works in Client Components. Add the "use client" directive to use it.`);
  };
}

export const useRouter = clientOnly("useRouter");
export const usePathname = clientOnly("usePathname");
export const useSearchParams = clientOnly("useSearchParams");
export const useParams = clientOnly("useParams");
export const useSelectedLayoutSegment = clientOnly("useSelectedLayoutSegment");
export const useSelectedLayoutSegments = clientOnly("useSelectedLayoutSegments");
