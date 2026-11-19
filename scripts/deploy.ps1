# Deploys TurnpikeAllowance with a Foundry keystore. Secrets are never stored in this file.
# Usage: ./scripts/deploy.ps1 -Keystore <path> -PasswordFile <path to a temp file you delete afterwards>
param(
  [Parameter(Mandatory)] [string]$Keystore,
  [Parameter(Mandatory)] [string]$PasswordFile,
  [string]$Rpc = "https://rpc1mainnet.qie.digital",
  [string]$Token = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  [string]$DepositCap = "5000000"
)
$art = Get-Content "$PSScriptRoot\..\artifacts\contracts\TurnpikeAllowance.sol\TurnpikeAllowance.json" -Raw | ConvertFrom-Json
$args32 = (cast abi-encode "constructor(address,uint256)" $Token $DepositCap).Substring(2)
$data = $art.bytecode + $args32
"creation bytecode keccak: " + (cast keccak $art.bytecode)
cast send --create $data --keystore $Keystore --password-file $PasswordFile --rpc-url $Rpc --json
