// @x402/core uses Buffer/process internally; provide browser shims for the bundle.
import { Buffer } from "buffer";
globalThis.Buffer = globalThis.Buffer || Buffer;
globalThis.global = globalThis.global || globalThis;
globalThis.process = globalThis.process || { env: {} };
