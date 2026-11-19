import Database from "better-sqlite3";

export type State = "ISSUED" | "PAID_PENDING" | "PAID_CONFIRMED" | "DELIVERED" | "EXPIRED" | "REJECTED";

export interface PaymentRow {
  requestId: string;
  nonce: string;
  resourceId: string;
  merchant: string;
  priceBase: string;
  chainId: number;
  contract: string;
  expiresAt: number;
  state: State;
  txHash: string | null;
  blockNumber: number | null;
  payer: string | null;
  responseBody: string | null;
  responseStatus: number | null;
  responseType: string | null;
  createdAt: number;
  updatedAt: number;
}

/** SQLite store (DATA-010, DATA-011). Synchronous transactions make state transitions atomic. */
export class Store {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        requestId TEXT PRIMARY KEY, nonce TEXT NOT NULL, resourceId TEXT NOT NULL, merchant TEXT NOT NULL,
        priceBase TEXT NOT NULL, chainId INTEGER NOT NULL, contract TEXT NOT NULL, expiresAt INTEGER NOT NULL,
        state TEXT NOT NULL, txHash TEXT UNIQUE, blockNumber INTEGER, payer TEXT,
        responseBody TEXT, responseStatus INTEGER, responseType TEXT,
        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, requestId TEXT NOT NULL, fromState TEXT, toState TEXT NOT NULL,
        detail TEXT, at INTEGER NOT NULL
      );
    `);
  }

  private now() {
    return Math.floor(Date.now() / 1000);
  }

  insert(r: Omit<PaymentRow, "state" | "txHash" | "blockNumber" | "payer" | "responseBody" | "responseStatus" | "responseType" | "createdAt" | "updatedAt">) {
    const t = this.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO payments (requestId,nonce,resourceId,merchant,priceBase,chainId,contract,expiresAt,state,createdAt,updatedAt)
           VALUES (@requestId,@nonce,@resourceId,@merchant,@priceBase,@chainId,@contract,@expiresAt,'ISSUED',${t},${t})`,
        )
        .run(r);
      this.log(r.requestId, null, "ISSUED", r.resourceId);
    })();
  }

  get(requestId: string): PaymentRow | undefined {
    return this.db.prepare("SELECT * FROM payments WHERE requestId = ?").get(requestId) as PaymentRow | undefined;
  }

  /** Atomic transition; returns false if the row is no longer in one of the allowed source states. */
  transition(requestId: string, from: State[], to: State, fields: Partial<PaymentRow> = {}, detail = ""): boolean {
    return this.db.transaction(() => {
      const row = this.get(requestId);
      if (!row || !from.includes(row.state)) return false;
      const sets = Object.keys(fields).map((k) => `${k} = @${k}`);
      this.db
        .prepare(`UPDATE payments SET state=@__to, updatedAt=@__t ${sets.length ? "," + sets.join(",") : ""} WHERE requestId=@__id`)
        .run({ ...fields, __to: to, __t: this.now(), __id: requestId });
      this.log(requestId, row.state, to, detail);
      return true;
    })();
  }

  log(requestId: string, from: State | null, to: State, detail: string) {
    this.db.prepare("INSERT INTO events (requestId,fromState,toState,detail,at) VALUES (?,?,?,?,?)").run(requestId, from, to, detail, this.now());
    // NFR-005 structured log
    if (process.env.TURNPIKE_LOG !== "off") console.log(JSON.stringify({ evt: "payment_state", requestId, from, to, detail }));
  }

  /** Counts for the evidence page (DATA-012). */
  stats(ownAddresses: string[]) {
    const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
    const rows = this.db.prepare("SELECT state, payer FROM payments WHERE state='DELIVERED'").all() as { state: string; payer: string | null }[];
    const ext = rows.filter((r) => r.payer && !own.has(r.payer.toLowerCase())).length;
    const stale = this.db.prepare("SELECT COUNT(*) c FROM payments WHERE state='PAID_CONFIRMED' AND updatedAt < ?").get(this.now() - 86400) as { c: number };
    return { delivered: rows.length, deliveredOwn: rows.length - ext, deliveredExternal: ext, paidUndelivered24h: stale.c };
  }

  close() {
    this.db.close();
  }
}
