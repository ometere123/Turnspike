param(
  [string]$Rpc = 'https://rpc1mainnet.qie.digital'
)

$hashes = @(
  '0xf7734fe4350a32496a4df328d2ec30a4e40bd2be31d3b81af0bfac9141522128',
  '0xdd54bd85f9397939c33c3f8d724b72074ea121ea45ca42b231b96de3d651ef61'
)

foreach ($hash in $hashes) {
  cast receipt $hash --rpc-url $Rpc --json
  cast rpc debug_traceTransaction $hash '{"tracer":"callTracer","timeout":"10s"}' --rpc-url $Rpc
}

