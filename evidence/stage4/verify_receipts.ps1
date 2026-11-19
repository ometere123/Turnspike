param(
  [string]$Rpc = 'https://rpc1mainnet.qie.digital',
  [string]$Policy = '0x6910ac4bAA0A94EC9F28052F971566Dd6B57DdAC'
)

$hashes = @(
  '0x199aa9b71639dd5a8f09576456c9631dfed5a93919a9610ae3de9b2abd39892a',
  '0xebba7a1ac5c1b6907173208e5ace965547f8b505e19bc485a511966b83b2fe3b',
  '0xa8bb764867795953ee4f65a0590dcaec778f92d9e4aa26b83ecc0c8177f6b77e',
  '0xe939ec3f5a2bf50eeac0b2cd519f48752dbd8a6db9acc05cd13f16a4b1dc6003',
  '0x05d3481ea2582e4c53b7f27d2e2ce32bf613d8afbfa4f534cb7fc0801b8d989b',
  '0x8a05699cdfc04f40d0c7d01ae878438f5493208363685afc1924e28439e08382',
  '0x4bdd9c9a810340ebccb46c819839c9f8dd4222ab2fe044a28917e5b9438d7fa0',
  '0x850153cbc997e04af9d26230c708eb244bcba2823c086bcd0e0dfe3c657b368d',
  '0x262de2517a0c49cb3eb0c4fe85b688bf653fc8ff83ab949386f9c6b9f7631ea7',
  '0xb51b4a8126fbe9a461a6280589a02d1e7469847379bd8d4c7240310c87abe583'
)

foreach ($hash in $hashes) {
  $receipt = cast receipt $hash --rpc-url $Rpc --json | ConvertFrom-Json
  $paid = @($receipt.logs | Where-Object { $_.address -ieq $Policy }).Count
  "{0} status={1} policyLogs={2} gasUsed={3}" -f $hash,$receipt.status,$paid,$receipt.gasUsed
}

