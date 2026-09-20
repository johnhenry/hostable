/**
 * @johnhenry/leserve ships no type declarations at all (confirmed --
 * no top-level "types" field, no .d.ts anywhere in the package), unlike
 * @johnhenry/dialback (which has a real types/types.d.ts, just not wired
 * into its exports map -- fixed there directly). Retrofitting full types
 * onto leserve is out of scope here; this ambient shim covers just the
 * one export this repo actually uses.
 */
declare module "@johnhenry/leserve/node-request" {
  export function toWebRequest(req: import("node:http").IncomingMessage, options?: { attachRaw?: boolean }): Request;
  export default toWebRequest;
}
