/**
 * Real end-to-end verification that @johnhenry/browsermesh-apps'
 * createBrowserMeshFetch() and @johnhenry/browsermesh-discovery's
 * MeshFetchRouter -- neither of which satisfies FetchLike directly --
 * plug into hostable's <Upstream app=/handler=> via fromFetchFn()/
 * fromNullableRouter() (src/adapt.ts), with a real HTTP round-trip
 * through a compiled Gateway.
 *
 * Imports from browsermesh-apps use its subpath exports
 * (./mesh-rpc, ./mesh-fetch, ./mesh-service -- added in
 * @johnhenry/browsermesh-apps@0.5.0) rather than the top-level `.`
 * entrypoint, which `export *`s from 70+ modules including an eager,
 * unconditional import of @johnhenry/browsermesh-transport -- this
 * integration needs none of that.
 *
 * The peer-to-peer wiring below (createPeer/wireNodes) mirrors
 * browsermesh-apps' own test/mesh-fetch.test.mjs fixture, minus the
 * `PeerRegistry`/`MeshACL`/`TrustGraph`/`MeshPeerManager` wiring that
 * fixture also builds (`PeerRegistry` lives in browsermesh-apps itself,
 * reachable via `./peer-registry`, not browsermesh-core as an earlier
 * draft of this file incorrectly assumed) -- `mesh-service.mjs`/
 * `mesh-rpc.mjs` (the two modules this integration actually uses) never
 * call `registry.checkAccess()` themselves, that's a `cloud-storage.mjs`/
 * `chunk-replication.mjs` concern, unrelated to plain mesh-rpc request/
 * response, so the registry wiring is real but unnecessary here. What's
 * real here: Ed25519 identities via `IdentityWallet`/
 * `MeshIdentityManager` (from @johnhenry/browsermesh-core), a real
 * `createMeshRpcService()`/`attachService()` pair, connected via a
 * minimal duck-typed in-memory bus (not real WebRTC -- that's
 * browsermesh's own later-phase work, not something this repo needs to
 * also stand up to verify the adapter).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachService } from "@johnhenry/browsermesh-apps/mesh-service";
import { createMeshRpcService } from "@johnhenry/browsermesh-apps/mesh-rpc";
import type { MeshRpcApi } from "@johnhenry/browsermesh-apps/mesh-rpc";
import { createBrowserMeshFetch } from "@johnhenry/browsermesh-apps/mesh-fetch";
import { MeshFetchRouter } from "@johnhenry/browsermesh-discovery";
import { IdentityWallet, MeshIdentityManager } from "@johnhenry/browsermesh-core";
import { compile } from "../src/compile.js";
import { Gateway, Host, Upstream } from "../src/components.js";
import { fromFetchFn, fromNullableRouter } from "../src/adapt.js";

interface Peer {
  podId: string;
  wallet: InstanceType<typeof IdentityWallet>;
}

async function createPeer(label: string): Promise<Peer> {
  const identityManager = new MeshIdentityManager({});
  const wallet = new IdentityWallet({ identityManager });
  const { podId } = await wallet.createIdentity(label);
  return { podId, wallet };
}

function wireNodes(peerA: Peer, peerB: Peer) {
  const listenersA = new Set<(from: string, data: unknown) => void>();
  const listenersB = new Set<(from: string, data: unknown) => void>();

  const nodeA = {
    podId: peerA.podId,
    wallet: peerA.wallet,
    onIncomingData(cb: (from: string, data: unknown) => void) {
      listenersA.add(cb);
      return () => listenersA.delete(cb);
    },
    async sendTo(_pubKey: unknown, data: unknown) {
      queueMicrotask(() => {
        for (const cb of listenersB) cb(peerA.podId, data);
      });
    },
  };
  const nodeB = {
    podId: peerB.podId,
    wallet: peerB.wallet,
    onIncomingData(cb: (from: string, data: unknown) => void) {
      listenersB.add(cb);
      return () => listenersB.delete(cb);
    },
    async sendTo(_pubKey: unknown, data: unknown) {
      queueMicrotask(() => {
        for (const cb of listenersA) cb(peerB.podId, data);
      });
    },
  };
  return { nodeA, nodeB };
}

async function withMeshPeers(
  bobHandler: (req: { podId: string; method: string; path: string; headers: object; body: unknown }) => Promise<{ status?: number; headers?: object; body?: unknown }>,
  run: (aliceApi: MeshRpcApi, bobPodId: string) => Promise<void>,
): Promise<void> {
  const alice = await createPeer("alice");
  const bob = await createPeer("bob");
  const { nodeA, nodeB } = wireNodes(alice, bob);
  attachService(nodeB, undefined, createMeshRpcService({ onRequest: bobHandler }));
  const { api: aliceApi } = attachService(nodeA, undefined, createMeshRpcService({}));
  await run(aliceApi, bob.podId);
}

test("createBrowserMeshFetch + fromFetchFn: a real gateway request forwards through a real mesh-rpc round trip", async () => {
  await withMeshPeers(
    async ({ method, path }) => {
      assert.equal(method, "GET");
      assert.equal(path, "/greet");
      return { status: 200, headers: { "content-type": "application/json" }, body: { hello: "alice" } };
    },
    async (aliceApi, bobPodId) => {
      const meshFetch = createBrowserMeshFetch(aliceApi);
      // The gateway's own routing is ordinary HTTP; the Upstream's job is
      // to translate a matched request into the mesh:// address of the
      // specific pod it should reach -- bobPodId is fixed per Upstream,
      // same shape as dialback's "one Server per targeted agent" pattern.
      const meshApp = fromFetchFn((_url, init) => meshFetch(`mesh://${bobPodId}/greet`, init));

      const tree = Gateway({ children: Upstream({ path: "/*", app: meshApp }) });
      const compiled = await compile(tree);
      const res = await compiled.fetch(new Request("http://gateway.example.com/greet"));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { hello: "alice" });
    },
  );
});

test("MeshFetchRouter + fromNullableRouter: matched under a *.mesh.local Host, falls through cleanly when not a mesh request", async () => {
  await withMeshPeers(
    async ({ path }) => ({ status: 200, headers: { "content-type": "text/plain" }, body: `served ${path}` }),
    async (aliceApi, bobPodId) => {
      const router = new MeshFetchRouter({
        onRpc: ({ podId, method, path, headers, body }) => aliceApi.request(podId, { method, path, headers, body }),
      });

      const tree = Gateway({
        children: Host({ pattern: "*.mesh.local", children: Upstream({ path: "/*", app: fromNullableRouter(router.route.bind(router)) }) }),
      });
      const compiled = await compile(tree);

      const res = await compiled.fetch(new Request(`http://${bobPodId}.mesh.local/x`));
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "served /x");

      // A request to a completely different (non-mesh) domain never
      // reaches this Host at all -- real domain isolation, not the
      // router's own null-fallback.
      const other = await compiled.fetch(new Request("http://not-mesh.example.com/x"));
      assert.equal(other.status, 404);
    },
  );
});
