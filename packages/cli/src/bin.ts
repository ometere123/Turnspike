#!/usr/bin/env node
import { createInterface } from "node:readline";
import { run, type Io } from "./cli";

const tty = !!process.stdin.isTTY;
const io: Io = {
  out: (s) => process.stdout.write(s + "\n"),
  err: (s) => process.stderr.write(s + "\n"),
  env: process.env,
  confirm: async (q) => {
    if (!tty) return false;
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const a: string = await new Promise((r) => rl.question(q, r));
    rl.close();
    return /^y(es)?$/i.test(a.trim());
  },
  secret: async (q) => {
    if (!tty) return undefined;
    process.stderr.write(q);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    let buf = "";
    return new Promise((resolve) => {
      const onData = (d: Buffer) => {
        for (const ch of d.toString("utf8")) {
          if (ch === "\r" || ch === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); process.stderr.write("\n"); return resolve(buf); }
          if (ch === "\u0003") { stdin.setRawMode(false); process.exit(130); }
          if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1); else buf += ch;
        }
      };
      stdin.on("data", onData);
    });
  },
};

run(process.argv.slice(2), io).then((code) => process.exit(code));
