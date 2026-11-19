# M2 smoke test on QIE mainnet (small amounts). Needs two keystores and a temp password file; stores no secrets.
param(
  [Parameter(Mandatory)] [string]$OwnerKeystore,
  [Parameter(Mandatory)] [string]$AgentKeystore,
  [Parameter(Mandatory)] [string]$PasswordFile,
  [Parameter(Mandatory)] [string]$Vault,
  [Parameter(Mandatory)] [string]$Merchant,
  [string]$Rpc = "https://rpc1mainnet.qie.digital",
  [string]$Token = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5"
)
$owner = (cast wallet address --keystore $OwnerKeystore --password-file $PasswordFile)
$agent = (cast wallet address --keystore $AgentKeystore --password-file $PasswordFile)
$ids = @(1..3 | ForEach-Object { cast keccak ("turnpike-smoke-" + [guid]::NewGuid()) })
function Send($ks, $to, $sig, $fnargs, $gas) {
  $a = @("send", $to, $sig) + $fnargs + @("--keystore", $ks, "--password-file", $PasswordFile, "--rpc-url", $Rpc, "--json")
  if ($gas) { $a += @("--gas-limit", $gas) }
  $o = & cast @a 2>&1 | Out-String
  try { $j = $o | ConvertFrom-Json; [pscustomobject]@{ step = $sig; tx = $j.transactionHash; status = $j.status; gasUsed = $j.gasUsed } }
  catch { [pscustomobject]@{ step = $sig; error = $o.Trim() } }
}
$res = @()
$res += Send $OwnerKeystore $Token "approve(address,uint256)" @($Vault, "50000")
$res += Send $OwnerKeystore $Vault "deposit(uint256)" @("50000")
$res += Send $OwnerKeystore $Vault "setPolicy(address,uint256,uint256)" @($agent, "10000", "30000")
$res += Send $OwnerKeystore $Vault "setMerchant(address,bool)" @($Merchant, "true")
$res += Send $AgentKeystore $Vault "pay(address,address,bytes32,uint256)" @($owner, $Merchant, $ids[0], "1000")                     # allowed
$res += Send $AgentKeystore $Vault "pay(address,address,bytes32,uint256)" @($owner, $Merchant, $ids[1], "10001") "300000"         # CapExceeded
$res += Send $AgentKeystore $Vault "pay(address,address,bytes32,uint256)" @($owner, $Merchant, $ids[0], "1000") "300000"         # RequestAlreadyUsed
$res | ConvertTo-Json
