# TectonicEditor Windows Build Setup & Build Script
# Run from PowerShell (not as admin unless for system-wide installs)
# Usage: .\scripts\build-windows.ps1

param(
  [switch]$SetupOnly,    # Install deps only, skip build
  [switch]$BuildOnly,    # Build only, skip setup
  [switch]$SkipPnpm      # Skip pnpm install (if already done)
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== TectonicEditor Windows Build ===" -ForegroundColor Cyan

# ─── 1. Check / Install Rust ───
if (-not $BuildOnly) {
  $rustup = Get-Command rustup -ErrorAction SilentlyContinue
  if (-not $rustup) {
    Write-Host "[1/4] Installing Rust..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile "$env:TEMP\rustup-init.exe"
    & "$env:TEMP\rustup-init.exe" -y --default-toolchain stable
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    Write-Host "  Rust installed. Restart your shell or run: `$env:PATH = `"`$env:USERPROFILE\.cargo\bin;`$env:PATH`"" -ForegroundColor Green
  } else {
    Write-Host "[1/4] Rust found: $(rustup --version)" -ForegroundColor Green
  }
}

# ─── 2. Check / Install pnpm ───
if (-not $BuildOnly) {
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if (-not $pnpm) {
    Write-Host "[2/4] Installing pnpm..." -ForegroundColor Yellow
    npm install -g pnpm
    if ($LASTEXITCODE -ne 0) {
      # npm not available, install via powershell
      Invoke-WebRequest -Uri "https://get.pnpm.io/install.ps1" -UseBasicParsing | Invoke-Expression
    }
    Write-Host "  pnpm installed." -ForegroundColor Green
  } else {
    Write-Host "[2/4] pnpm found: $(pnpm --version)" -ForegroundColor Green
  }
}

# ─── 3. Install vcpkg + Tectonic dependencies ───
if (-not $BuildOnly) {
  $VcpkgRoot = "$env:USERPROFILE\vcpkg"
  $VcpkgExe = "$VcpkgRoot\vcpkg.exe"

  if (-not (Test-Path $VcpkgExe)) {
    Write-Host "[3/4] Installing vcpkg..." -ForegroundColor Yellow
    git clone https://github.com/microsoft/vcpkg.git "$VcpkgRoot"
    Push-Location $VcpkgRoot
    .\bootstrap-vcpkg.bat
    Pop-Location
    Write-Host "  vcpkg bootstrapped." -ForegroundColor Green
  } else {
    Write-Host "[3/4] vcpkg found at $VcpkgRoot" -ForegroundColor Green
  }

  Write-Host "  Installing Tectonic system dependencies via vcpkg..." -ForegroundColor Yellow
  & $VcpkgExe install harfbuzz[graphite2] freetype icu fontconfig --triplet x64-windows-static
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  vcpkg install failed. Try running manually:" -ForegroundColor Red
    Write-Host "    $VcpkgExe install harfbuzz[graphite2] freetype icu fontconfig"
    exit 1
  }
  Write-Host "  vcpkg packages installed." -ForegroundColor Green
}

# ─── 4. Set environment & install pnpm deps ───
$env:TECTONIC_DEP_BACKEND = "vcpkg"
$env:VCPKG_ROOT = "$env:USERPROFILE\vcpkg"
$env:CXXFLAGS = "-std=c++17"
$env:CFLAGS = ""

Write-Host "[4/4] Environment set:" -ForegroundColor Cyan
Write-Host "  TECTONIC_DEP_BACKEND = vcpkg"
Write-Host "  VCPKG_ROOT          = $env:VCPKG_ROOT"
Write-Host "  CXXFLAGS            = -std=c++17"

if (-not $SkipPnpm) {
  Write-Host "  Installing pnpm dependencies..." -ForegroundColor Yellow
  Push-Location $RepoRoot
  pnpm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  pnpm install failed." -ForegroundColor Red
    exit 1
  }
  Pop-Location
  Write-Host "  pnpm install done." -ForegroundColor Green
}

# ─── 5. Build ───
if ($SetupOnly) {
  Write-Host "`nSetup complete. To build, run: pnpm build:desktop" -ForegroundColor Green
  exit 0
}

Write-Host "`nBuilding TectonicEditor for Windows..." -ForegroundColor Cyan
Push-Location $RepoRoot
pnpm build:desktop
if ($LASTEXITCODE -ne 0) {
  Write-Host "Build failed." -ForegroundColor Red
  Pop-Location
  exit 1
}
Pop-Location

Write-Host "`n=== Build complete! ===" -ForegroundColor Green
Write-Host "Artifacts: apps\desktop\src-tauri\target\release\bundle\" -ForegroundColor White
