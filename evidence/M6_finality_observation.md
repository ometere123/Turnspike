# M6 TEST-X01: block hash stability observation (read-only)

Method. A script polled `eth_blockNumber` on both RPCs every ~3 s for about 5.5 minutes (51 passes, 2026-11-19 03:20:42Z to 03:26:10Z UTC) and fetched each new
block's hash and parentHash from rpc1 (https://rpc1mainnet.qie.digital) and rpc2 (https://rpc2mainnet.qie.digital), starting 2 blocks behind the head.
On every pass it also re-queried rpc1 for heights head-1, head-3, head-6 and head-12 (earlier heights after later ones were observed).
After the last block it re-queried every height on both RPCs ("final"). No transactions were sent; only `eth_blockNumber` and `eth_getBlockByNumber`.

## Raw numbers
- Heights observed: 12009798 to 12009891 = 94 consecutive heights (>= 60 required, plan asks >= 50).
- Block queries: 570 total (rpc1 forward 94, rpc2 forward 94, rpc1 re-query 194, rpc1 final 94, rpc2 final 94). Query errors: 0.
- Heights whose hash differed between any two observations on the same RPC: 0 of 94.
- Heights where rpc1 and rpc2 returned different hashes: 0 of 94.
- Parent-hash linkage across the final rpc1 set: 93 of 93 links consistent (block n.parentHash == block n-1.hash).
- Block time (timestamp deltas, 93 intervals): 3 s x 37, 4 s x 56 (mean about 3.6 s).
- rpc1 minus rpc2 head height at poll time: equal in 42 polls, rpc2 one block behind in 9 polls (rpc2 never ahead).
- First block 12009798 hash 0xbad8aef14a0b56dd50ea54420ea50199a5d2637455790440d0599f2a448d0d06 (ts 03:20:32Z);
  last block 12009891 hash 0x1a15a363b8c924ec139048c3a734c5eabde158e6891f015971a9bd50e7e110ef (ts 03:26:07Z).
- Re-queries of head-1 (one block deep, a few seconds after the first look) and head-3/6/12 did not change.

## Conclusion (limited to what was observed)
In this ~5.5 minute window no reorg was seen: no block hash for a height changed on either RPC, the two RPCs agreed on every height they both served,
and parent links were continuous. This does NOT prove finality. It cannot show behaviour under load, validator faults or network partitions, over
longer horizons, or the consensus rules. Reorgs deeper than the sampling could be rare events not visible in 5.5 minutes. The first sight of each block was typically at 0 to 1
confirmations and later re-queries (up to 12+ blocks deep, and final re-query up to about 94 blocks deep) never differed. Nothing here justifies a specific
`CONFIRMATIONS` value beyond "zero reorgs observed at any depth sampled"; a conservative setting (for example a few blocks, about 10 to 20 s) is a policy
choice, not something established by this test. rpc2 occasionally lagged rpc1 by one block, so a gateway that fails over between them should tolerate a one-block head difference.
Status for TEST-X01: executed as an observation; finality NOT verified.
