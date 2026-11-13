$ErrorActionPreference = 'Continue'
$key = 'sb_publishable_ecd68T10S_gRouDU5q0EwA_ZW0gp3Oy'
$base = 'https://yvnqvdyhrmrzxdwhnydc.supabase.co'

function Probe([string]$path) {
  $full = $base + '/rest/v1/' + $path
  $req = [System.Net.HttpWebRequest]::Create($full)
  $req.Headers.Add('apikey', $key)
  $req.Headers.Add('Authorization', 'Bearer ' + $key)
  $req.Method = 'GET'
  $req.Timeout = 15000
  try {
    $resp = $req.GetResponse()
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $body = $sr.ReadToEnd()
    Write-Output ('OK   ' + $path + ' -> ' + $body)
  } catch [System.Net.WebException] {
    $r = $_.Exception.Response
    $code = 0
    $body = ''
    if ($r) {
      $code = [int]$r.StatusCode
      $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
      $body = $sr.ReadToEnd()
    }
    Write-Output ('FAIL ' + $path + ' [' + $code + '] ' + $body)
  }
}

$cols = @('id','user_id','email','full_name','name','avatar_url','created_at','updated_at',
  'plan','plan_name','status','is_active','active','expires_at','started_at','provider',
  'tokens_used','tokens_limit','subscription_status','subscription_active','has_subscription',
  'current_period_end','trial_ends_at','cancel_at_period_end','tokens_reset_at','last_reset_at')

foreach ($t in @('profiles','subscriptions')) {
  Write-Output ('=== ' + $t)
  foreach ($c in $cols) { Probe ($t + '?select=' + $c + '&limit=1') }
}
