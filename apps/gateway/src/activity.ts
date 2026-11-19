export interface PeerFlow { in: bigint; out: bigint; count: number }

/**
 * Largest counterparties by total volume (in + out), compared as bigint. Converting to Number would lose precision above
 * 2^53 base units and could misorder large holders. Ties keep a stable address order.
 */
export function rankCounterparties(peers: Map<string, PeerFlow>, limit = 10) {
  return [...peers.entries()]
    .sort((x, y) => {
      const d = (y[1].in + y[1].out) - (x[1].in + x[1].out);
      return d > 0n ? 1 : d < 0n ? -1 : x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0;
    })
    .slice(0, limit)
    .map(([address, p]) => ({ address, inBase: p.in.toString(), outBase: p.out.toString(), transfers: p.count }));
}
