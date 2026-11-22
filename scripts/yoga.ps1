# yoga-auto: od zera do uruchomienia na Yodze. Uruchamiaj przez yoga.bat w korzeniu repo.
# Windows PowerShell 5.1, plik celowo w ASCII (bez polskich znakow), zeby 5.1 czytal go poprawnie.
param(
  [ValidateSet("game", "mock", "replay", "check", "plugin", "help")]
  [string]$Mode = "game",
  [string]$Ets2Dir = "",
  [int]$Port = 7420,
  [string]$Scenario = "highway",
  [string]$Replay = "tools/recorder/samples/highway-60s.yarec",
  [switch]$SkipInstall,
  [switch]$SkipPlugin,
  [switch]$NoFirewall,
  [switch]$NoAuth,
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Write-Step([string]$text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Write-Warn2([string]$text) { Write-Host "    !!  $text" -ForegroundColor Yellow }
function Stop-WithError([string]$text) { Write-Host ""; Write-Host "BLAD: $text" -ForegroundColor Red; exit 1 }

function Invoke-Native([string]$what, [scriptblock]$cmd) {
  & $cmd
  if ($LASTEXITCODE -ne 0) { Stop-WithError "$what (kod $LASTEXITCODE)" }
}

if ($Mode -eq "help") {
  Write-Host @"
yoga.bat [tryb] [opcje]

Tryby:
  game    (domyslny) npm install, gen, build aplikacji, build pluginu, DLL do ETS2, zapora, bridge na grze
  mock    to samo bez pluginu, bridge na mocku (-Scenario highway|city-night|low-fuel|crash|job-cycle)
  replay  bridge odtwarza nagranie (-Replay <plik.yarec>, domyslnie probka highway-60s)
  check   npm run check (generatory + typecheck + testy)
  plugin  tylko build pluginu i kopia DLL do ETS2

Opcje:
  -Ets2Dir "D:\Steam\steamapps\common\Euro Truck Simulator 2"   gdy autowykrycie nie znajdzie gry
  -Port 7420        port bridge'a
  -SkipInstall      bez npm install
  -SkipPlugin       bez budowania i kopiowania pluginu
  -NoFirewall       nie sprawdzaj zapory
  -NoAuth           bez parowania PIN (tylko do testow w zaufanej sieci)
  -NoStart          wszystko przygotuj, ale nie uruchamiaj bridge'a

Przyklady:
  yoga.bat
  yoga.bat mock -Scenario city-night
  yoga.bat game -Ets2Dir "D:\SteamLibrary\steamapps\common\Euro Truck Simulator 2"
"@
  exit 0
}

# ---------------------------------------------------------------- 1. Node
Write-Step "Node.js"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Stop-WithError "Brak Node.js. Zainstaluj Node 24 LTS z https://nodejs.org i uruchom yoga.bat ponownie." }
$nodeVer = (& node -v).Trim()
$nodeMajor = [int]($nodeVer.TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 24) { Stop-WithError "Node $nodeVer jest za stary, potrzebny Node 24+ (https://nodejs.org)." }
Write-Ok "node $nodeVer"

# ---------------------------------------------------------------- 2. Zaleznosci i generatory
if (-not $SkipInstall) {
  Write-Step "npm install"
  Invoke-Native "npm install" { npm install --no-audit --no-fund }
  Write-Ok "zaleznosci zainstalowane"
}

Write-Step "Generatory (protokol, tokeny)"
Invoke-Native "npm run gen" { npm run gen --silent }
Write-Ok "wygenerowane"

if ($Mode -eq "check") {
  Write-Step "npm run check"
  Invoke-Native "npm run check" { npm run check }
  Write-Ok "wszystko zielone"
  exit 0
}

# ---------------------------------------------------------------- 3. Aplikacja (PWA)
if ($Mode -ne "plugin") {
  Write-Step "Build aplikacji (apps/yoga/dist)"
  Invoke-Native "build aplikacji" { npm run build:app --silent }
  Write-Ok "PWA gotowe"
}

# ---------------------------------------------------------------- 4. Plugin + ETS2
function Find-CMake {
  $c = Get-Command cmake -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhere) {
    $found = & $vswhere -latest -products * -find "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe" | Select-Object -First 1
    if ($found -and (Test-Path $found)) { return $found }
  }
  return $null
}

function Find-Ets2 {
  $candidates = @()
  if ($Ets2Dir) { $candidates += $Ets2Dir }
  if ($env:ETS2_DIR) { $candidates += $env:ETS2_DIR }
  $steam = $null
  try { $steam = (Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -Name SteamPath -ErrorAction Stop).SteamPath } catch {}
  if (-not $steam) { $steam = Join-Path ${env:ProgramFiles(x86)} "Steam" }
  $libs = @($steam)
  $vdf = Join-Path $steam "steamapps\libraryfolders.vdf"
  if (Test-Path $vdf) {
    foreach ($m in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"')) {
      $libs += $m.Groups[1].Value.Replace("\\", "\")
    }
  }
  foreach ($lib in $libs) { $candidates += (Join-Path $lib "steamapps\common\Euro Truck Simulator 2") }
  foreach ($dir in $candidates) {
    if ($dir -and (Test-Path (Join-Path $dir "bin\win_x64\eurotrucks2.exe"))) { return (Resolve-Path $dir).Path }
  }
  return $null
}

if (($Mode -eq "game" -or $Mode -eq "plugin") -and -not $SkipPlugin) {
  Write-Step "Plugin yoga_auto.dll"
  $dll = Join-Path $Root "plugin\build\Release\yoga_auto.dll"
  $cmake = Find-CMake
  if (-not (Test-Path (Join-Path $Root "plugin\third_party\scs_sdk_1_16"))) {
    Write-Warn2 "brak SCS SDK w plugin\third_party\scs_sdk_1_16 - pomijam build (patrz docs/SETUP.md)"
  } elseif (-not $cmake) {
    Write-Warn2 "nie znaleziono CMake (VS Build Tools 2026 z C++ i CMake) - pomijam build"
  } else {
    Push-Location (Join-Path $Root "plugin")
    try {
      Invoke-Native "cmake configure" { & $cmake --preset vs }
      Invoke-Native "cmake build" { & $cmake --build --preset release }
    } finally { Pop-Location }
    Write-Ok "zbudowany: $dll"
  }

  if (Test-Path $dll) {
    $ets2 = Find-Ets2
    if (-not $ets2) {
      Write-Warn2 "nie znaleziono ETS2. Podaj sciezke: yoga.bat game -Ets2Dir ""<folder gry>"""
    } elseif (Get-Process eurotrucks2 -ErrorAction SilentlyContinue) {
      Write-Warn2 "ETS2 jest uruchomiony - zamknij gre, zeby podmienic DLL (uzywam obecnej wersji)"
    } else {
      $plugins = Join-Path $ets2 "bin\win_x64\plugins"
      try {
        New-Item -ItemType Directory -Force -Path $plugins | Out-Null
        Copy-Item -Force $dll (Join-Path $plugins "yoga_auto.dll")
        Write-Ok "DLL skopiowany do $plugins"
      } catch {
        Write-Warn2 "brak uprawnien do $plugins. Uruchom yoga.bat jako administrator albo skopiuj recznie:"
        Write-Host "      copy ""$dll"" ""$plugins\"""
      }
    }
  } else {
    Write-Warn2 "brak zbudowanego DLL - gra nie bedzie wysylac telemetrii"
  }
}

if ($Mode -eq "plugin") { exit 0 }

# ---------------------------------------------------------------- 5. Siec i zapora
# tylko karty z brama domyslna (Wi-Fi/Ethernet), bez wirtualnych WSL/Hyper-V
$ips = @()
try {
  $ips = @(Get-NetIPConfiguration -ErrorAction Stop |
    Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Where-Object { $_ -and $_ -notlike "169.254.*" })
} catch {}

if (-not $NoFirewall) {
  Write-Step "Siec i zapora"
  try {
    $public = Get-NetConnectionProfile -ErrorAction Stop | Where-Object { $_.NetworkCategory -eq "Public" }
    foreach ($p in $public) {
      Write-Warn2 "siec ""$($p.Name)"" jest Publiczna - Yoga sie nie polaczy. Zmien na Prywatna: Ustawienia > Siec i Internet > Wi-Fi > (siec) > Profil sieci: Prywatna"
    }
  } catch {}
  $rule = Get-NetFirewallRule -DisplayName "yoga-auto bridge" -ErrorAction SilentlyContinue
  if ($rule) {
    Write-Ok "regula zapory 'yoga-auto bridge' istnieje"
  } else {
    Write-Host "    Brak reguly zapory dla TCP $Port (tylko siec Prywatna). Bez niej Yoga nie polaczy sie z PC."
    $ans = Read-Host "    Dodac regule teraz? Windows zapyta o uprawnienia administratora [T/n]"
    if ($ans -eq "" -or $ans -match "^[TtYy]") {
      $cmdLine = "New-NetFirewallRule -DisplayName 'yoga-auto bridge' -Direction Inbound -Protocol TCP -LocalPort $Port -Profile Private -Action Allow"
      try {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile", "-Command", $cmdLine
        if (Get-NetFirewallRule -DisplayName "yoga-auto bridge" -ErrorAction SilentlyContinue) { Write-Ok "regula dodana" }
        else { Write-Warn2 "regula nie zostala dodana" }
      } catch { Write-Warn2 "anulowano. Recznie (PowerShell jako admin): $cmdLine" }
    } else {
      Write-Warn2 "pominieto. Recznie (PowerShell jako admin): New-NetFirewallRule -DisplayName 'yoga-auto bridge' -Direction Inbound -Protocol TCP -LocalPort $Port -Profile Private -Action Allow"
    }
  }
}

# ---------------------------------------------------------------- 6. Instrukcja dla Yogi
$host1 = if ($ips.Count -gt 0) { $ips[0] } else { "<adres-PC>" }
Write-Step "Na Yodze"
Write-Host "    1. Polacz Yoge z ta sama siecia Wi-Fi (najlepiej 5 GHz)."
Write-Host "    2. W Edge otworz:"
foreach ($ip in $ips) { Write-Host "         http://${ip}:$Port" -ForegroundColor White }
Write-Host "         albo http://$($env:COMPUTERNAME.ToLower()).local:$Port"
if (-not $NoAuth) { Write-Host "    3. Wpisz 6-cyfrowy PIN, ktory bridge wypisze w tym oknie (wazny 120 s)." }
Write-Host "    Kiosk na stale (skrot na Yodze, szczegoly docs/kiosk.md):"
Write-Host "      msedge.exe --kiosk http://${host1}:$Port --edge-kiosk-type=fullscreen --no-first-run --disable-pinch --overscroll-history-navigation=0"
if ($Mode -eq "game") {
  Write-Host "    Gra: uruchom ETS2 i potwierdz okno 'advanced SDK features' przy starcie. Log pluginu:"
  Write-Host "      $env:USERPROFILE\Documents\Euro Truck Simulator 2\yoga-auto.log"
}

if ($NoStart) { Write-Host ""; Write-Ok "gotowe (bez uruchamiania bridge'a: -NoStart)"; exit 0 }

# ---------------------------------------------------------------- 7. Bridge
$busy = $null
try { $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop } catch {}
if ($busy) { Stop-WithError "port $Port jest zajety (PID $($busy[0].OwningProcess)). Zamknij poprzedni bridge albo uzyj -Port." }

$bridgeArgs = @("bridge/src/main.ts", "--port", "$Port")
switch ($Mode) {
  "game"   { $bridgeArgs += @("--source", "pipe") }
  "mock"   { $bridgeArgs += @("--source", "mock", "--scenario", $Scenario) }
  "replay" { $bridgeArgs += @("--source", "replay", "--replay", $Replay, "--loop") }
}
if ($NoAuth) { $bridgeArgs += "--no-auth" }

Write-Step "Bridge ($Mode) - Ctrl+C konczy"
& node @bridgeArgs
exit $LASTEXITCODE
