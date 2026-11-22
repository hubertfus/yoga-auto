# Helper SMTC dla @yoga-auto/media. Windows PowerShell 5.1, bez kompilacji natywnej.
# Protokol JSON-lines (UTF-8):
#   stdout: {"t":"ready"} | {"t":"state","s":{...}|null} | {"t":"art","key":"..","mime":"..","b64":".."} | {"t":"ack","id":N,"ok":bool,"err":".."} | {"t":"error","msg":".."}
#   stdin : {"id":N,"cmd":"play|pause|toggle|next|prev|seek","value":sekundy}
param([switch]$PreferSpotify, [int]$PollMs = 300)
$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding $false
$out = New-Object System.IO.StreamWriter ([Console]::OpenStandardOutput()), $enc
$out.AutoFlush = $true
$out.NewLine = "`n"
$in = New-Object System.IO.StreamReader ([Console]::OpenStandardInput()), $enc
function Emit($o) { $out.WriteLine(($o | ConvertTo-Json -Compress -Depth 6)) }

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
  $asTaskG = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await($op, [Type]$type) {
    $t = $asTaskG.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $t.Wait(4000)) { throw 'timeout WinRT' }
    $t.Result
  }
  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch {
  Emit @{ t = 'error'; msg = "init: $($_.Exception.Message)" }
  exit 2
}

function Pick-Session {
  if ($PreferSpotify) {
    foreach ($s in $mgr.GetSessions()) { if ($s.SourceAppUserModelId -match 'spotify') { return $s } }
  }
  return $mgr.GetCurrentSession()
}

$script:mediaKeyType = $null
function Send-MediaKey([byte]$vk) {
  if (-not $script:mediaKeyType) {
    $script:mediaKeyType = Add-Type -Namespace Yoga -Name Keys -PassThru -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, int flags, int extra);'
  }
  $script:mediaKeyType::keybd_event($vk, 0, 0, 0)
  $script:mediaKeyType::keybd_event($vk, 0, 2, 0)
}

function Run-Command($c, $session) {
  $cmd = $c.cmd
  if (-not $session) {
    # fallback: klawisze multimedialne, gdy brak sesji SMTC
    switch ($cmd) {
      'play' { Send-MediaKey 0xB3 }
      'pause' { Send-MediaKey 0xB3 }
      'toggle' { Send-MediaKey 0xB3 }
      'next' { Send-MediaKey 0xB0 }
      'prev' { Send-MediaKey 0xB1 }
      default { throw 'brak sesji' }
    }
    return
  }
  $ok = $false
  switch ($cmd) {
    'play' { $ok = Await ($session.TryPlayAsync()) ([bool]) }
    'pause' { $ok = Await ($session.TryPauseAsync()) ([bool]) }
    'toggle' { $ok = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
    'next' { $ok = Await ($session.TrySkipNextAsync()) ([bool]) }
    'prev' { $ok = Await ($session.TrySkipPreviousAsync()) ([bool]) }
    'seek' { $ok = Await ($session.TryChangePlaybackPositionAsync([long]([double]$c.value * 1e7))) ([bool]) }
    default { throw "nieznana komenda $cmd" }
  }
  if (-not $ok) { throw "odrzucone przez $($session.SourceAppUserModelId)" }
}

function Get-Art($props) {
  if (-not $props.Thumbnail) { return $null }
  $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $size = [uint32]$stream.Size
  if ($size -eq 0) { return $null }
  $reader = New-Object Windows.Storage.Streams.DataReader -ArgumentList $stream
  $null = Await ($reader.LoadAsync($size)) ([uint32])
  $bytes = New-Object byte[] $size
  $reader.ReadBytes($bytes)
  return @{ mime = $stream.ContentType; b64 = [Convert]::ToBase64String($bytes) }
}

$statusMap = @{ 4 = 'playing'; 5 = 'paused'; 3 = 'stopped'; 2 = 'stopped'; 1 = 'stopped'; 0 = 'unknown' }
$lastSig = $null; $lastPos = $null; $lastAt = [DateTime]::UtcNow; $lastPlaying = $false
$artKey = $null; $artTries = 0; $artDone = $false
$readTask = $in.ReadLineAsync()
Emit @{ t = 'ready' }

while ($true) {
  try {
    $session = Pick-Session
    # --- komendy ---
    while ($readTask.IsCompleted) {
      $line = $readTask.Result
      if ($null -eq $line) { exit 0 }  # stdin zamkniety = rodzic padl
      $readTask = $in.ReadLineAsync()
      if (-not $line.Trim()) { continue }
      $c = $line | ConvertFrom-Json
      try { Run-Command $c $session; Emit @{ t = 'ack'; id = $c.id; ok = $true } }
      catch { Emit @{ t = 'ack'; id = $c.id; ok = $false; err = $_.Exception.Message } }
      $lastSig = $null  # wymus odswiezenie stanu po komendzie
    }
    # --- stan ---
    if (-not $session) {
      if ($lastSig -ne 'none') { Emit @{ t = 'state'; s = $null }; $lastSig = 'none'; $artKey = $null }
    } else {
      $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $pb = $session.GetPlaybackInfo(); $tl = $session.GetTimelineProperties(); $ctl = $pb.Controls
      $status = $statusMap[[int]$pb.PlaybackStatus]
      $playing = $status -eq 'playing'
      $dur = $tl.EndTime.TotalSeconds - $tl.StartTime.TotalSeconds
      $pos = $null
      if ($dur -gt 0) {
        $pos = $tl.Position.TotalSeconds
        if ($playing) { $pos += ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalSeconds }
        $pos = [Math]::Round([Math]::Max(0, [Math]::Min($dur, $pos)), 1)
      }
      $src = $session.SourceAppUserModelId
      $sig = "$src|$status|$($props.Title)|$($props.Artist)|$($props.AlbumTitle)|$dur|$($ctl.IsPlayEnabled)$($ctl.IsPauseEnabled)$($ctl.IsNextEnabled)$($ctl.IsPreviousEnabled)$($ctl.IsPlaybackPositionEnabled)"
      $now = [DateTime]::UtcNow
      $drift = $false
      if ($null -ne $pos -and $null -ne $lastPos) {
        $expected = if ($lastPlaying) { $lastPos + ($now - $lastAt).TotalSeconds } else { $lastPos }
        $drift = [Math]::Abs($pos - $expected) -gt 2
      }
      if ($sig -ne $lastSig -or $drift) {
        Emit @{ t = 'state'; s = @{
            source = $src; status = $status; title = $props.Title; artist = $props.Artist; album = $props.AlbumTitle
            position = $pos; duration = $(if ($dur -gt 0) { [Math]::Round($dur, 1) } else { $null })
            canPlay = [bool]$ctl.IsPlayEnabled; canPause = [bool]$ctl.IsPauseEnabled; canNext = [bool]$ctl.IsNextEnabled
            canPrev = [bool]$ctl.IsPreviousEnabled; canSeek = [bool]$ctl.IsPlaybackPositionEnabled } }
        $lastSig = $sig; $lastPos = $pos; $lastAt = $now; $lastPlaying = $playing
      }
      # okladka: pobierz po zmianie utworu, ponawiaj kilka razy (Spotify dosyla pozno)
      $key = "$src|$($props.Title)|$($props.Artist)|$($props.AlbumTitle)"
      if ($key -ne $artKey) { $artKey = $key; $artTries = 0; $artDone = $false }
      if (-not $artDone -and $artTries -lt 6) {
        $artTries++
        $art = Get-Art $props
        if ($art) { Emit @{ t = 'art'; key = $key; mime = $art.mime; b64 = $art.b64 }; $artDone = $true }
      }
    }
  } catch {
    Emit @{ t = 'error'; msg = $_.Exception.Message }
    Start-Sleep -Milliseconds 1000
  }
  Start-Sleep -Milliseconds $PollMs
}
