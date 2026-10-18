// The App Router's navigation state, which next/navigation's hooks read:
// { pathname, searchParams, params, router }. The SSR entry provides it
// from the request, the browser's app router from the current URL.
import { createContext } from "react";

export const AppNavContext = createContext(null);
