/**
 * Forwarding gateway traffic into a real browsermesh peer, two ways:
 *
 * 1. `@johnhenry/browsermesh-apps`' `createBrowserMeshFetch()` is a bare
 *    `fetch(url, init)`-shaped function, not an object with `.fetch` --
 *    doesn't satisfy `FetchLike` directly. `fromFetchFn()` (src/adapt.ts)
 *    adapts it into an `app=` value.
 * 2. `@johnhenry/browsermesh-discovery`'s `MeshFetchRouter#route()`
 *    returns `Response | null` (the Service-Worker-interceptor
 *    convention) -- doesn't satisfy `FetchLike` either. `fromNullableRouter()`
 *    adapts it, with a 404 fallback for `null`, and pairs naturally with
 *    `<Host pattern="*.mesh.local">` since that's the exact hostname
 *    shape `MeshFetchRouter` itself already expects.
 *
 * Unlike `dialback` (whose `Server` instance already satisfies
 * `FetchLike` directly, no adapter needed), neither of these two
 * browsermesh exports matches the shape as-is -- confirmed by reading
 * mesh-fetch.mjs/sw-routing.mjs directly, not assumed.
 *
 * Imports from browsermesh-apps use its subpath exports (`./mesh-rpc`,
 * `./mesh-fetch`, `./mesh-service`, added in
 * `@johnhenry/browsermesh-apps@0.5.0`), not the top-level `.`
 * entrypoint -- that one `export *`s from 70+ modules including an
 * eager, unconditional import of `@johnhenry/browsermesh-transport`,
 * none of which this example needs.
 *
 * This example stands up two real Ed25519-identified peers ("alice" the
 * gateway side, "bob" the mesh side) wired over a minimal in-memory bus
 * (not real WebRTC -- that's browsermesh's own later-phase work), same
 * level of realism browsermesh's own test suite uses.
 *
 * Run with:
 *   npm run build && node dist/examples/06-browsermesh/server.js
 * Then (both routes forward to the same "bob" peer, one via a fixed
 * mesh:// address, the other via the podId embedded in the Host header):
 *   curl http://localhost:3015/anything -H "Host: direct.example.com"
 *   curl http://localhost:3015/anything -H "Host: <bob's podId printed at startup>.mesh.local"
 */
/** @jsxImportSource @johnhenry/hostable */
import { attachService } from "@johnhenry/browsermesh-apps/mesh-service";
import { createMeshRpcService } from "@johnhenry/browsermesh-apps/mesh-rpc";
import { createBrowserMeshFetch } from "@johnhenry/browsermesh-apps/mesh-fetch";
import { MeshFetchRouter } from "@johnhenry/browsermesh-discovery";
import { IdentityWallet, MeshIdentityManager } from "@johnhenry/browsermesh-core";
import { Gateway, Host, Upstream, fromFetchFn, fromNullableRouter, compile } from "@johnhenry/hostable";
import { serve } from "@johnhenry/hostable/adapters/node";

async function createPeer(label: string) {
  const identityManager = new MeshIdentityManager({});
  const wallet = new IdentityWallet({ identityManager });
  const { podId } = await wallet.createIdentity(label);
  return { podId, wallet };
}

function wireNodes(peerA: { podId: string }, peerB: { podId: string }) {
  const listenersA = new Set<(from: string, data: unknown) => void>();
  const listenersB = new Set<(from: string, data: unknown) => void>();
  const nodeA = {
    podId: peerA.podId,
    onIncomingData: (cb: (from: string, data: unknown) => void) => (listenersA.add(cb), () => listenersA.delete(cb)),
    sendTo: async (_pubKey: unknown, data: unknown) => queueMicrotask(() => listenersB.forEach((cb) => cb(peerA.podId, data))),
  };
  const nodeB = {
    podId: peerB.podId,
    onIncomingData: (cb: (from: string, data: unknown) => void) => (listenersB.add(cb), () => listenersB.delete(cb)),
    sendTo: async (_pubKey: unknown, data: unknown) => queueMicrotask(() => listenersA.forEach((cb) => cb(peerB.podId, data))),
  };
  return { nodeA, nodeB };
}

const alice = await createPeer("alice"); // the gateway's own identity
const bob = await createPeer("bob"); // the mesh peer being reached
const { nodeA, nodeB } = wireNodes(alice, bob);

attachService(
  nodeB,
  undefined,
  createMeshRpcService({
    async onRequest({ path }) {
      return { status: 200, headers: { "content-type": "text/plain" }, body: `bob served ${path}` };
    },
  }),
);
const { api: aliceApi } = attachService(nodeA, undefined, createMeshRpcService({}));

const meshFetch = createBrowserMeshFetch(aliceApi);
const router = new MeshFetchRouter({
  onRpc: ({ podId, method, path, headers, body }) => aliceApi.request(podId, { method, path, headers, body }),
});

const app = (
  <Gateway>
    {/* 1: a fixed-target Upstream, forwarding everything to bob specifically via createBrowserMeshFetch */}
    <Host name="direct.example.com">
      <Upstream path="/*" app={fromFetchFn((_url, init) => meshFetch(`mesh://${bob.podId}/greet`, init))} />
    </Host>
    {/* 2: any *.mesh.local domain routes through MeshFetchRouter, podId taken from the hostname itself */}
    <Host pattern="*.mesh.local">
      <Upstream path="/*" app={fromNullableRouter(router.route.bind(router))} />
    </Host>
  </Gateway>
);

const compiled = await compile(app);
serve(compiled, { port: 3015 });
console.log(`listening on http://localhost:3015 -- bob's podId is ${bob.podId}`);
console.log('try: curl http://localhost:3015/anything -H "Host: direct.example.com"');
console.log(`  or: curl http://localhost:3015/anything -H "Host: ${bob.podId}.mesh.local"`);
