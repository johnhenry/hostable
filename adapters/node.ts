// hostable's compiled output IS a servable-compiled dispatcher -- the
// adapter needs no hostable-specific logic, just a thin re-export.
export { serve } from "@johnhenry/servable/adapters/node";
export type { ListenOptions } from "@johnhenry/servable/adapters/node";
