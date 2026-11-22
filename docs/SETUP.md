# yoga-auto — co pobrać i zainstalować

## PC z grą

| # | Co | Link | Uwagi |
|---|---|---|---|
| 1 | **Build Tools for Visual Studio** (kompilator C++ i CMake) | https://visualstudio.microsoft.com/visual-cpp-build-tools/ | W instalatorze zaznacz workload **„Desktop development with C++”** (w polskiej wersji: „Programowanie aplikacji klasycznych w języku C++”). W prawym panelu muszą być zaznaczone: *MSVC … x64/x86 build tools*, *Windows 11 SDK*, *C++ CMake tools for Windows*. Ok. 6–8 GB. |
| 2 | **SCS SDK 1.16** | https://download.eurotrucksimulator2.com/scs_sdk_1_16.zip | Rozpakuj do `plugin\third_party\scs_sdk_1_16\` w tym repo (powinny tam być foldery `include\` i `examples\`). |
| ✅ | Zainstalowane | — | VS Build Tools 2026 (18.7.2) z MSVC, CMake i Windows SDK 10.0.26100; SDK rozpakowane poprawnie |
| 3 | Node.js 24 | — | ✅ już masz (v24.18.0) |
| 4 | Git | — | ✅ już masz (2.54) |

Sprawdzenie po instalacji (w nowym oknie „Developer PowerShell for VS”):

```powershell
cl
```

```powershell
cmake --version
```

## Yoga

Nic nie trzeba pobierać, bo Edge jest w systemie. Jeśli chcesz, sprawdź model, żebym dobrał ustawienia szkła:

```powershell
Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model; Get-CimInstance Win32_VideoController | Select-Object Name, CurrentHorizontalResolution, CurrentVerticalResolution; (Get-CimInstance Win32_OperatingSystem).Caption
```

## Później (nie teraz)

| Kiedy | Co |
|---|---|
| M3, tylko gdy moduł media w Node nie wystarczy | Rust: https://rustup.rs (do helpera SMTC) |
| M4 (mapa) | tippecanoe (przez WSL), instrukcja w briefie S8 |
