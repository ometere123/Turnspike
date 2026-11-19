import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { FileJournal, MemoryJournal, type JournalRecord } from "../src";

const rec = (over: Partial<JournalRecord> = {}): JournalRecord => ({ key: "k", url: "http://x/v1/a", method: "GET", state: "reserved", owner: "0x0", agent: "0x0", updatedAt: 0, ...over });
const fresh = () => join(mkdtempSync(join(tmpdir(), "tsjl-")), "journal.json");
const old = (file: string) => { const t = new Date(Date.now() - 10 * 60_000); utimesSync(file, t, t); }; // well past any age-based timeout
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid!; // the process has exited when spawnSync returns

describe("journal compare-and-set and file locking", () => {
  for (const [name, make] of [["memory", () => new MemoryJournal()], ["file", () => new FileJournal(fresh())]] as const) {
    it(`J-1 ${name}: swap writes only against the exact revision; null only when absent or failed`, async () => {
      const j = make();
      expect(await j.swap(rec({ rev: 1 }), null)).toBe(true);
      expect(await j.swap(rec({ rev: 2 }), null)).toBe(false); // not absent, not failed
      expect(await j.swap(rec({ state: "challenged", rev: 2 }), 1)).toBe(true);
      expect(await j.swap(rec({ state: "failed", rev: 2 }), 1)).toBe(false); // stale copy (rev 1) cannot overwrite rev 2
      expect((await j.get("k"))!.state).toBe("challenged");
      expect(await j.swap(rec({ state: "failed", rev: 3 }), 2)).toBe(true);
      expect(await j.swap(rec({ rev: 4 }), 3)).toBe(true); // a failed record is replaced at its revision
    });
  }

  it("J-2 a lock held by a live process is never taken, however old: the operation fails and the lock stays", async () => {
    const path = fresh();
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    try {
      writeFileSync(`${path}.lock`, JSON.stringify({ host: hostname(), pid: child.pid, token: "live" }));
      old(`${path}.lock`); // a paused owner: the lock file is ten minutes old
      const j = new FileJournal(path, { lockWaitMs: 300 });
      await expect(j.swap(rec({ rev: 1 }), null)).rejects.toThrow(/held/);
      expect(JSON.parse(readFileSync(`${path}.lock`, "utf8")).token).toBe("live");
      expect(existsSync(path)).toBe(false); // nothing was written
    } finally { child.kill(); }
  });

  it("J-3 a lock left by a dead process on this host is reaped and the operation proceeds", async () => {
    const path = fresh();
    writeFileSync(`${path}.lock`, JSON.stringify({ host: hostname(), pid: deadPid(), token: "dead" }));
    const j = new FileJournal(path, { lockWaitMs: 2000 });
    expect(await j.swap(rec({ rev: 1 }), null)).toBe(true);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it("J-4 a lock from another host is never reaped, even if that pid is not running here", async () => {
    const path = fresh();
    writeFileSync(`${path}.lock`, JSON.stringify({ host: "some-other-host", pid: deadPid(), token: "remote" }));
    old(`${path}.lock`);
    await expect(new FileJournal(path, { lockWaitMs: 300 }).get("k")).rejects.toThrow(/held/);
    expect(JSON.parse(readFileSync(`${path}.lock`, "utf8")).token).toBe("remote");
  });

  it("J-5 an unreadable or half-written lock is never reaped", async () => {
    const path = fresh();
    writeFileSync(`${path}.lock`, "");
    old(`${path}.lock`);
    await expect(new FileJournal(path, { lockWaitMs: 300 }).get("k")).rejects.toThrow(/held/);
    expect(existsSync(`${path}.lock`)).toBe(true);
  });

  it("J-6 two OS processes racing swap(null) on one file: exactly one wins, in every round", async () => {
    const dist = join(__dirname, "../dist/journal.js");
    if (!existsSync(dist)) expect(spawnSync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: join(__dirname, ".."), shell: true }).status).toBe(0);
    const script = `const {FileJournal}=require(${JSON.stringify(dist)});const j=new FileJournal(process.argv[1]);` +
      `const go=Number(process.argv[2]);while(Date.now()<go){}` + // both children start the race at the same instant
      `j.swap({key:"k",url:"u",method:"GET",state:"reserved",owner:"o",agent:"a",rev:1,updatedAt:0},null).then(ok=>process.stdout.write(ok?"won":"lost"));`;
    const child = (path: string, go: number) => new Promise<string>((res) => {
      const c = spawn(process.execPath, ["-e", script, path, String(go)]);
      let out = ""; c.stdout.on("data", (d) => (out += d)); c.on("close", () => res(out));
    });
    for (let round = 0; round < 5; round++) {
      const path = fresh();
      const go = Date.now() + 700;
      expect((await Promise.all([child(path, go), child(path, go)])).sort()).toEqual(["lost", "won"]);
      expect(existsSync(`${path}.lock`)).toBe(false);
    }
  }, 120_000);
});
