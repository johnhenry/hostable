/**
 * @johnhenry/browsermesh-apps, @johnhenry/browsermesh-core, and
 * @johnhenry/browsermesh-discovery ship no type declarations at all
 * (confirmed -- no top-level "types" field, no .d.ts anywhere in any of
 * the three packages), same gap already found in @johnhenry/leserve.
 * Retrofitting full types onto all three is well out of scope here; this
 * shim covers only what test/browsermesh-adapt.test.ts actually uses.
 * The two real integration-surface signatures (`createBrowserMeshFetch`,
 * `MeshFetchRouter`) are typed precisely, verified by reading
 * mesh-fetch.mjs/sw-routing.mjs directly; `IdentityWallet`/
 * `MeshIdentityManager` are pure test-fixture wiring (real Ed25519
 * identities, so `podId` is genuine), typed loosely since their
 * internals aren't what's being tested here.
 */
declare module "@johnhenry/browsermesh-apps" {
  export interface MeshRpcApi {
    request(podId: string, req: { method?: string; path?: string; headers?: object; body?: unknown }): Promise<{ status: number; headers: object; body: unknown }>;
  }
  export function createBrowserMeshFetch(
    meshRpcApi: MeshRpcApi,
  ): (url: string, init?: { method?: string; headers?: object; body?: unknown }) => Promise<Response>;

  export interface MeshRpcServiceOptions {
    onRequest?(req: { podId: string; method: string; path: string; headers: object; body: unknown }): Promise<{ status?: number; headers?: object; body?: unknown }>;
  }
  export function createMeshRpcService(options: MeshRpcServiceOptions): unknown;
  export function attachService(node: unknown, network: unknown, service: unknown): { api: MeshRpcApi };
}

declare module "@johnhenry/browsermesh-discovery" {
  export function parseMeshRequest(urlStr: string): { podId: string; path: string } | null;

  export interface MeshFetchRouterOptions {
    onRpc(req: { podId: string; method: string; path: string; headers: object; body: unknown }): Promise<{ status?: number; headers?: object; body?: unknown }>;
  }
  export class MeshFetchRouter {
    constructor(options: MeshFetchRouterOptions);
    route(request: Request): Promise<Response | null>;
  }
}

declare module "@johnhenry/browsermesh-core" {
  export class IdentityWallet {
    constructor(options: { identityManager: unknown });
    createIdentity(label: string): Promise<{ podId: string }>;
  }
  export class MeshIdentityManager {
    constructor(options: object);
  }
}
