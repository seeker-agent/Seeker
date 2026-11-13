$b = [System.IO.File]::ReadAllBytes("logo.png")
$w = ($b[16] -shl 24) + ($b[17] -shl 16) + ($b[18] -shl 8) + $b[19]
$h = ($b[20] -shl 24) + ($b[21] -shl 16) + ($b[22] -shl 8) + $b[23]
Write-Output "$w x $h"
