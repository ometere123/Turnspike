// Shared start/stop for the local Hardhat node the specs use.
// The node is started through `npx` in a shell, so it is a process tree (sh -> npm exec -> node). On Windows `taskkill /T`
// ends the tree. On POSIX the tree must be signalled as a group: the node is started detached (its own process group) and
// the group is killed. `taskkill` does not exist on Linux, which used to leave every node running until the job ended.
import { spawn, spawnSync, ChildProcess } from "node:child_process";

const win = process.platform === "win32";

export function startNode(port: number, cwd: string): ChildProcess {
  return spawn("npx", ["hardhat", "node", "--port", String(port)], { cwd, shell: true, stdio: "ignore", detached: !win });
}

export function stopNode(node?: ChildProcess): void {
  if (!node || node.pid === undefined) return;
  try {
    if (win) spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
    else process.kill(-node.pid, "SIGKILL");
  } catch { /* already gone */ }
}
