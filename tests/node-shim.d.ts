// Minimal Node typings for unit tests. Avoids a @types/node dependency.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
declare const __dirname: string;
