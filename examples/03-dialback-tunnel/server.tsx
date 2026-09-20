/**
 * Forwarding gateway traffic to an agent behind NAT/a firewall through a
 * real @johnhenry/dialback tunnel. A dialback `Server` instance is already
 * Fetch-shaped (`server.fetch(request): Promise<Response>`), so it needs
 * no special-case gateable code at all -- it's just another `app=` value,
 * the exact same mechanism examples/02 uses to mount a servable app.
 *
 * This example runs both sides in one process for a self-contained demo
 * (the gateway+dialback Server, and a real dialback Agent connecting to
 * it) -- in a real deployment, the Agent runs on a separate machine behind
 * the NAT/firewall, dialing out to the publicly-reachable Server.
 *
 * Run with:
 *   npm run build && node dist/examples/03-dialback-tunnel/server.js
 * Then:
 *   curl http://localhost:3012/anything
 */
/** @jsxImportSource @johnhenry/hostable */
import http from "node:http";
import { WebSocketServer } from "ws";
import { Server, Agent } from "@johnhenry/dialback";
import { toWebRequest } from "@johnhenry/leserve/node-request";
import { Gateway, Upstream, compile } from "@johnhenry/hostable";

// --- The dialback Server side (would normally be the only thing running on the public host) ---
const TUNNEL_SECRET = "example-shared-secret"; // a real deployment reads this from the environment
const dialbackServer = new Server(async () => new Response("no agent connected", { status: 502 }), { secret: TUNNEL_SECRET });
const tunnelHttpServer = http.createServer(async (req, res) => {
  const response = await dialbackServer.fetch(toWebRequest(req));
  res.writeHead(response.status, response.statusText, Object.fromEntries(response.headers));
  res.end(await response.text());
});
const wss = new WebSocketServer({ server: tunnelHttpServer });
wss.on("connection", (ws) => {
  dialbackServer.addConnection(ws as never);
  ws.on("close", () => dialbackServer.removeConnection(ws as never));
});
await new Promise<void>((resolve) => tunnelHttpServer.listen(0, resolve));
const tunnelPort = (tunnelHttpServer.address() as { port: number }).port;

// --- The Agent side (would normally run on a separate machine behind NAT) ---
const agent = new Agent(`ws://localhost:${tunnelPort}`, { secret: TUNNEL_SECRET });
agent.serve(async (request: Request) => new Response(`agent behind NAT saw ${new URL(request.url).pathname}`));
await agent.connection; // real tunnel established

// --- The gateway: forwards public traffic through the tunnel via app= ---
const app = (
  <Gateway>
    <Upstream path="/*" app={dialbackServer} />
  </Gateway>
);

const compiled = await compile(app);
const { serve: serveGateway } = await import("@johnhenry/hostable/adapters/node");
serveGateway(compiled, { port: 3012 });
console.log("listening on http://localhost:3012 -- forwards through a real dialback tunnel to a connected Agent");
